var fs = require('fs');
var args = require('./args');
var creds = require('./creds');

var hosts = buildHostMap(args._);
addCredentials(hosts, creds);
module.exports = hosts;


/**
 *
 * @param {string[]} hostPathPairs - an array of pairs like ['nickc@tst-web1:/var/log/httpd.log']
 * @returns {{object}} a map of host names to host objects like {password: 'blah', paths: []}
 */
function buildHostMap(hostPathPairs) {
    var hosts = {};
    hostPathPairs.forEach(function(pair) {
        var hostAndPair = pair.split(':');
        if (hostAndPair.length != 2) {
            console.log('Failed to parse ' + pair);
            process.exit(1);
        }
        var host = hostAndPair[0];
        var path = hostAndPair[1];
        if (host in hosts) {
            hosts[host].paths.push(path);
        } else {
            hosts[host] = {
                paths: [path]
            };
        }
    });

    return hosts;
}


/**
 * Add login credentials for each host. This mutates the hosts map param.
 * 
 * @param {object} hosts - an object of hosts generated by buildHostMap
 * @param {string} credentialMap - user@host to password
 */
function addCredentials(hosts, credentialMap) {
    if (!credentialMap) {
        return;
    }
    for (var hostName in hosts) {
        var host = hosts[hostName];
        if (hostName in credentialMap) {
            var credentials = credentialMap[hostName];
            host['user'] = credentials['user'];
            
            if (credentials['password']) {
                host['password'] = credentials['password'];
            } else if (credentials['privateKey']) {
                host['privateKey'] = fs.readFileSync(credentials['privateKey']);
            }
            
            if (credentials['port']) {
                host['port'] = credentials['port'];
            } else {
                host['port'] = 22;
            }
        }
    }
}