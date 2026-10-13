import { createFileRoute } from '@tanstack/react-router';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { MissingPassage } from '../components/MissingPassage.js';
import { Learn } from '../practice/Learn.js';
import { usePassage } from '../store/hooks.js';

/** Practising one passage. */
const Practice = () => {
	const { id } = Route.useParams();
	const passage = usePassage(id);
	if (passage === undefined) return <main className="screen" aria-busy="true" />;
	if (passage === null) return <MissingPassage />;
	// Keyed by passage, so going from one to another starts afresh.
	return <Learn key={passage.id} passage={passage} />;
};

export const Route = createFileRoute('/practice/$id')({
	component: Practice,
	errorComponent: ErrorScreen,
});
