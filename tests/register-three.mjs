// Node-only test resolution for the exact vendored Three.js used in Safari.
import { register } from 'node:module';
register('./three-loader.mjs',import.meta.url);
