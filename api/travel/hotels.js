/* 旅遊規劃的飯店查詢（POST /api/travel/hotels）。只開放給登入且未停用的 Claude Flow 使用者。 */
import { toVercelHandler } from '../_lib/adapter.js';
import { hotelsHandler } from '../_lib/hotels.js';

export default toVercelHandler((input, env, ctx) => hotelsHandler(input, env, ctx));
