/* 旅遊規劃的餐廳查詢（POST /api/travel/restaurants）。只開放給登入且未停用的 Claude Flow 使用者。 */
import { toVercelHandler } from '../_lib/adapter.js';
import { restaurantsHandler } from '../_lib/restaurants.js';

export default toVercelHandler((input, env, ctx) => restaurantsHandler(input, env, ctx));
