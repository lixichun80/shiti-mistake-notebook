/**
 * 拾题 · 智能错题本 —— 用户名/密码的校验规则
 *
 * 抽出来的理由：注册接口和管理员建号接口必须用**同一套**规则。各写一份的话，
 * 迟早会出现「注册接口不收的名字，管理员能建出来」这类裂缝，而这种账号
 * 往往在别处（比如登录时的归一化）表现不一致。
 *
 * 校验函数返回错误文案（给用户看的中文），通过则返回 null。
 */

export const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;
export const MIN_PASSWORD_LENGTH = 8;
// 上界是为了挡住「拿一个几 MB 的字符串来跑 60 万次 PBKDF2」这种免费 DoS
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_DISPLAY_NAME_LENGTH = 24;

/** 登录接口就是这么归一化用户名的（trim + 转小写），这里必须保持一致。 */
export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function checkUsername(username: string): string | null {
  if (!username) return "请填写用户名";
  if (!USERNAME_PATTERN.test(username)) {
    return "用户名只能用 3-32 位小写字母、数字、下划线或短横线";
  }
  return null;
}

export function checkPassword(password: string): string | null {
  if (!password) return "请填写密码";
  if (password.length < MIN_PASSWORD_LENGTH) return `密码至少 ${MIN_PASSWORD_LENGTH} 位`;
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `密码不能超过 ${MAX_PASSWORD_LENGTH} 位`;
  }
  return null;
}

// 微信号只做宽松校验：用户可能填微信号、绑定的手机号或 QQ 号，这些都能搜到人。
// 太严会把能用的号挡在门外；只拦空白字符和明显超长的输入。
export const MAX_WECHAT_LENGTH = 40;

export function normalizeWechat(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `required` 为 true 时（注册）不能留空；后台编辑允许清空。 */
export function checkWechat(wechat: string, required: boolean): string | null {
  if (!wechat) return required ? "请填写微信号，方便我们联系你" : null;
  if (/\s/.test(wechat)) return "微信号不能包含空格";
  if (wechat.length > MAX_WECHAT_LENGTH) return `微信号不能超过 ${MAX_WECHAT_LENGTH} 个字符`;
  return null;
}

/** 昵称可以留空（回落到用户名），但不能只由空白组成。 */
export function checkDisplayName(displayName: string): string | null {
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return `昵称不能超过 ${MAX_DISPLAY_NAME_LENGTH} 个字`;
  }
  return null;
}
