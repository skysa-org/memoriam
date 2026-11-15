import { createContext, Fragment, type ReactNode, useContext } from 'react';

import { db as appDb, type MemoriamDatabase } from './db.js';

/**
 * The database a component reads and writes: the app's own, unless a provider
 * above it names another — a test's, made for it alone (`freshDatabase`). Not
 * handed down as a prop, which reached a component more than one way and left
 * what it read through its own hooks the app's database whatever it had been
 * handed.
 */
const DatabaseContext = createContext<MemoriamDatabase>(appDb);

/**
 * What it holds is drawn afresh for another database, by its name (one name,
 * one database): a hook's answers were read from the one before, and none of
 * them is checked against which database it came from.
 */
export const DatabaseProvider = ({
	db,
	children,
}: {
	db: MemoriamDatabase;
	children: ReactNode;
}) => (
	<DatabaseContext.Provider value={db}>
		<Fragment key={db.name}>{children}</Fragment>
	</DatabaseContext.Provider>
);

/** The database the component is drawn over: the app's, outside a provider. */
export const useDb = (): MemoriamDatabase => useContext(DatabaseContext);
