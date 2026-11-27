/* 動畫製作的配音（POST /api/animate/voice）。只開放給登入且未停用的 Claude Flow 使用者。 */
import { toVercelHandler } from '../_lib/adapter.js';
import { animateVoiceHandler } from '../_lib/animate-voice.js';

export default toVercelHandler((input, env, ctx) => animateVoiceHandler(input, env, ctx));
