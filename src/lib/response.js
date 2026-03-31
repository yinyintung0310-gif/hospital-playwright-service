function successResponse({ hospitalId, hospitalName, searchUrl, keyword, results }) {
  return {
    hospitalId,
    hospitalName,
    source: 'playwright-service',
    status: results.length > 0 ? 'success' : 'no_result',
    keyword,
    searchUrl,
    results
  };
}

function errorResponse({ hospitalId, hospitalName, searchUrl, keyword, error }) {
  return {
    hospitalId,
    hospitalName,
    source: 'playwright-service',
    status: 'error',
    keyword,
    searchUrl,
    error,
    results: []
  };
}

module.exports = { successResponse, errorResponse };

