const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // Log the error
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`, {
    stack: err.stack,
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Enviar resposta genérica para evitar vazar stack trace no client em produção
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
}

module.exports = errorHandler;
