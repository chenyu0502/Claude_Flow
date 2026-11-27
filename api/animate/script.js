/* 動畫製作的劇本生成（POST /api/animate/script）。只開放給登入且未停用的 Claude Flow 使用者。 */
import { toVercelHandler } from '../_lib/adapter.js';
import { animateScriptHandler } from '../_lib/animate.js';

export default toVercelHandler((input, env, ctx) => animateScriptHandler(input, env, ctx));
