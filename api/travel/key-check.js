/* 旅遊規劃的金鑰檢查（POST /api/travel/key-check）。只開放給登入且未停用的 Claude Flow 使用者。 */
import { toVercelHandler } from '../_lib/adapter.js';
import { keyCheckHandler } from '../_lib/keycheck.js';

export default toVercelHandler((input, env, ctx) => keyCheckHandler(input, env, ctx));
