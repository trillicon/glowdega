import { requireAdmin } from '../_lib/access.js';

export const onRequest = requireAdmin;
