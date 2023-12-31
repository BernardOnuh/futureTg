// middlewares.js
module.exports = {
  logMiddleware(ctx, next) {
    // Check if ctx.message is defined before accessing its properties
    const messageText = ctx.message ? ctx.message.text : 'No text available';
    console.log(`Received message: ${messageText}`);
    next();
  },
};
