import { corpusGate } from './gate.js';

// `deck` symlinks the skill's templates/ (spec 10): the skill must pass its own tool with zero entries.
corpusGate('templates', ['deck']);
