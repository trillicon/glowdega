// Repository source files are not part of the public site.
import { notFound } from '../_lib/posts.js';

export const onRequest = ({ env, request }) => notFound(env, request);
