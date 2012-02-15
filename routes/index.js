var package = require('../package');

/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', {
    title: 'Fedor Indutny',
    layout: null,
    version: package.version
  });
};
