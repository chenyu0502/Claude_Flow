/* 旅遊規劃的景點門票查詢（POST /api/travel/tickets）。只開放給登入且未停用的 Claude Flow 使用者。 */
import { toVercelHandler } from '../_lib/adapter.js';
import { ticketsHandler } from '../_lib/tickets.js';

export default toVercelHandler((input, env, ctx) => ticketsHandler(input, env, ctx));
