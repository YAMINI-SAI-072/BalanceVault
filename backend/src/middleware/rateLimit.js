import "dotenv/config";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const redis = Redis.fromEnv();

// General API limit: 100 requests per minute per IP.
const apiLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1 m"),
  prefix: "balancevault:api"
});

// Authentication limit: 5 requests per minute per IP.
const authLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  prefix: "balancevault:auth"
});

function createRateLimitMiddleware(limiter) {
  return async (req, res, next) => {
    try {
      const identifier = req.ip || "unknown";

      const result = await limiter.limit(identifier);

      res.set("RateLimit-Limit", String(result.limit));
      res.set("RateLimit-Remaining", String(result.remaining));
      res.set("RateLimit-Reset", String(Math.ceil(result.reset / 1000)));

      if (!result.success) {
        return res.status(429).json({
          message: "Too many requests. Please try again later."
        });
      }

      next();
    } catch (error) {
      console.error("Rate limiter error:", error);

      return res.status(503).json({
        message: "Rate limiting service is temporarily unavailable"
      });
    }
  };
}

export const apiRateLimit = createRateLimitMiddleware(apiLimiter);
export const authRateLimit = createRateLimitMiddleware(authLimiter);
