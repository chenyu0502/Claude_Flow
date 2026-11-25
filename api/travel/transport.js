/* 旅遊規劃的交通票券分析（POST /api/travel/transport）。只開放給登入且未停用的 Claude Flow 使用者。 */
import { toVercelHandler } from '../_lib/adapter.js';
import { transportHandler } from '../_lib/transport.js';

export default toVercelHandler((input, env, ctx) => transportHandler(input, env, ctx));
