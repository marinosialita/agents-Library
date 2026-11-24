import { handleWebAsset } from '../../server/web-asset.ts';
// A public page's module scripts for the right-hand viewer (server/web-asset.ts).
export default { fetch: (request: Request) => handleWebAsset(request) };
