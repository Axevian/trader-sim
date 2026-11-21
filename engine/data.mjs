import * as kraken from './kraken.mjs';
import * as mock from './mock.mjs';
export default process.env.MOCK ? mock : kraken;
