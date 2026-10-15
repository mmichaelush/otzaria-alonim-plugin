// Registry in the order sources are shown (and preferred for duplicates).
import * as ladaat from './ladaat.mjs';
import * as tashma from './tashma.mjs';
import * as gilyoines from './gilyoines.mjs';
import * as alonolam from './alonolam.mjs';

export const connectors = [ladaat, tashma, gilyoines, alonolam];
export const byId = Object.fromEntries(connectors.map((c) => [c.id, c]));
