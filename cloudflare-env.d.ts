declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DEEPSEEK_API_KEY?: string;
    /** 会话 cookie 的 HMAC 签名密钥，至少 32 字符。缺失会让登录接口 500。 */
    SESSION_SECRET?: string;
    /**
     * 是否信任 `oai-authenticated-user-*` 请求头。
     * 只有本地开发（mock-auth）才设 "1"；生产环境绝不能设，
     * 否则任何人手工加一个请求头就能绕过登录。
     */
    TRUST_OAI_HEADERS?: string;
  }
}
