/* 旅遊規劃的航班查詢（POST /api/travel/flights）。只開放給登入且未停用的 Claude Flow 使用者。 */
import { toVercelHandler } from '../_lib/adapter.js';
import { flightsHandler } from '../_lib/flights.js';

export default toVercelHandler((input, env, ctx) => flightsHandler(input, env, ctx));
