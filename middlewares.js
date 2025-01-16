// middlewares.js
const logMiddleware = async (ctx, next) => {
  const start = new Date();
  await next();
  const ms = new Date() - start;
  console.log('Response time: %sms', ms);
};

module.exports = {
  logMiddleware
};