import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema.js';

/**
 * Migrations run once, in order, against whatever a deployment already holds,
 * and `wrangler d1 migrations apply` has no rollback. Memoriam starts from one
 * migration, `0000_init.sql`, written by `drizzle-kit generate` from
 * `src/db/schema.ts` (skysa-notes' schema as its seven migrations leave it, less
 * its two unused sign-in tables). What these hold is that the files apply from
 * empty in order, and that the database they make is the one the schema
 * describes — so a change to `schema.ts` without a migration beside it fails
 * here rather than in a deployment.
 */

const DIR = new URL('../migrations/', import.meta.url).pathname;

const files = (): string[] =>
	readdirSync(DIR)
		.filter((name) => name.endsWith('.sql'))
		.sort();

const statements = (name: string): string[] =>
	readFileSync(join(DIR, name), 'utf8')
		.split('--> statement-breakpoint')
		.map((statement) => statement.trim())
		.filter((statement) => statement !== '');

/** Every migration, in order, as `wrangler d1 migrations apply` would run them. */
const migrated = (): DatabaseSync => {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const name of files()) {
		for (const statement of statements(name)) db.exec(statement);
	}
	return db;
};

const TABLES: readonly SQLiteTable[] = [schema.connections, schema.grants];

interface Journal {
	entries: { idx: number; tag: string }[];
}

interface Snapshot {
	tables: Record<
		string,
		{
			columns: Record<string, { notNull: boolean; primaryKey: boolean }>;
			indexes: Record<string, { columns: string[]; isUnique: boolean }>;
			foreignKeys: Record<
				string,
				{ tableTo: string; columnsFrom: string[]; columnsTo: string[]; onDelete: string }
			>;
		}
	>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(DIR, path), 'utf8')) as T;

/** What `schema.ts` says each table is, in the terms SQLite reports them in. */
const declared = (table: SQLiteTable) => {
	const config = getTableConfig(table);
	const columnName = (column: unknown): string =>
		typeof column === 'object' && column !== null && 'name' in column
			? String(column.name)
			: 'an expression';
	return {
		name: config.name,
		columns: config.columns
			.map((column) => ({
				name: column.name,
				notNull: column.notNull,
				primaryKey: column.primary,
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
		indexes: config.indexes
			.map((index) => ({
				name: index.config.name,
				columns: index.config.columns.map(columnName),
				unique: index.config.unique,
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
		foreignKeys: config.foreignKeys.map((key) => {
			const reference = key.reference();
			return {
				from: reference.columns.map((column) => column.name),
				table: getTableConfig(reference.foreignTable).name,
				to: reference.foreignColumns.map((column) => column.name),
				onDelete: key.onDelete ?? 'no action',
			};
		}),
	};
};

/** What the migrated database says the same table is. */
const actual = (db: DatabaseSync, name: string) => {
	const columns = db.prepare(`PRAGMA table_info(${name})`).all() as {
		name: string;
		notnull: number;
		pk: number;
	}[];
	const indexes = (
		db.prepare(`PRAGMA index_list(${name})`).all() as {
			name: string;
			unique: number;
			origin: string;
		}[]
	)
		// `pk` is SQLite's own index behind a text primary key, which no schema
		// declares.
		.filter((index) => index.origin === 'c');
	const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${name})`).all() as {
		table: string;
		from: string;
		to: string;
		on_delete: string;
	}[];

	return {
		name,
		columns: columns
			.map((column) => ({
				name: column.name,
				// SQLite reports a primary key as nullable unless it says otherwise;
				// drizzle writes `PRIMARY KEY NOT NULL`, so both agree it is not.
				notNull: column.notnull === 1,
				primaryKey: column.pk > 0,
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
		indexes: indexes
			.map((index) => ({
				name: index.name,
				columns: (
					db.prepare(`PRAGMA index_info(${index.name})`).all() as { name: string }[]
				).map((column) => column.name),
				unique: index.unique === 1,
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
		foreignKeys: foreignKeys.map((key) => ({
			from: [key.from],
			table: key.table,
			to: [key.to],
			onDelete: key.on_delete.toLowerCase(),
		})),
	};
};

describe('the migrations', () => {
	it('are the files the journal lists, in its order', () => {
		// `wrangler` runs the `.sql` files by name; `drizzle-kit` diffs against
		// the journal's last snapshot. A file one has and the other does not is
		// a migration that runs without being diffed against, or the reverse.
		const journal = readJson<Journal>('meta/_journal.json');
		expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(files());
		expect(journal.entries.map((entry) => entry.idx)).toEqual(
			files().map((_name, index) => index)
		);
	});

	it('apply cleanly from empty, in order', () => {
		expect(migrated).not.toThrow();
	});

	it('make exactly the tables the schema declares', () => {
		const db = migrated();
		const tables = (
			db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
				)
				.all() as { name: string }[]
		).map((row) => row.name);

		expect(tables).toEqual(TABLES.map((table) => getTableConfig(table).name).sort());
	});

	it.each(TABLES.map((table) => [getTableConfig(table).name, table] as const))(
		'make %s as the schema declares it: columns, indexes and foreign keys',
		(name, table) => {
			expect(actual(migrated(), name)).toEqual(declared(table));
		}
	);

	it('leave the snapshot drizzle-kit diffs against agreeing with the schema', () => {
		// `drizzle-kit generate` writes the next migration from the difference
		// between `schema.ts` and the last snapshot. A snapshot that disagrees
		// with the schema is a next migration that undoes or repeats something.
		const journal = readJson<Journal>('meta/_journal.json');
		const last = journal.entries.at(-1);
		const snapshot = readJson<Snapshot>(
			`meta/${String(last?.idx ?? 0).padStart(4, '0')}_snapshot.json`
		);

		const fromSnapshot = Object.entries(snapshot.tables)
			.map(([name, table]) => ({
				name,
				columns: Object.entries(table.columns)
					.map(([column, { notNull, primaryKey }]) => ({
						name: column,
						notNull,
						primaryKey,
					}))
					.sort((a, b) => a.name.localeCompare(b.name)),
				indexes: Object.entries(table.indexes)
					.map(([index, { columns, isUnique }]) => ({
						name: index,
						columns,
						unique: isUnique,
					}))
					.sort((a, b) => a.name.localeCompare(b.name)),
				foreignKeys: Object.values(table.foreignKeys).map((key) => ({
					from: key.columnsFrom,
					table: key.tableTo,
					to: key.columnsTo,
					onDelete: key.onDelete,
				})),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		expect(fromSnapshot).toEqual(
			TABLES.map(declared).sort((a, b) => a.name.localeCompare(b.name))
		);
	});

	it('leave a grant unreachable, but still there, once its connection goes', () => {
		const db = migrated();
		db.prepare(
			'INSERT INTO storage_connections (id, provider, account_id, display_name, secret_ciphertext, secret_iv, secret_key_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
		).run('c', 'dropbox', 'dbid:1', 'x', 'c', 'i', 'k1');
		db.prepare(
			'INSERT INTO grants (id, connection_id, secret_hash, created_at, last_used_at) VALUES (?, ?, ?, 0, 0)'
		).run('g', 'c', 'h');

		db.prepare('DELETE FROM storage_connections WHERE id = ?').run('c');

		// The DDL the migration writes has to be `ON DELETE set null`: a cascade
		// would delete the row and free its hash for anyone holding a copy of the
		// credential to claim again.
		expect(db.prepare('SELECT id, connection_id FROM grants').all()).toEqual([
			{ id: 'g', connection_id: null },
		]);
	});
});
