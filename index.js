#!/usr/bin/env node

/**
 * High level explanation:
 *  Get credentials from credentials file and arguments and create a credentials map
 *  Get hosts information from arguments and build a hosts map
 *  Add the credentials map data to the hosts map
 *  Connect to every host in the hosts map
 */
var SshClient = require('ssh2').Client;
var hostUtils = require('./lib/hosts');
var credentialUtils = require('./lib/creds');
var colors = require('colors');
var readlineSync = require('readline-sync');
var path = require('path');
var fs = require('fs');
var osenv = require('osenv');
var program = require('commander');
var packageJson = require('./package.json');
var parseSshConfig = require('ssh-config-parser');

var DEFAULT_CREDENTIALS_LOCATION = path.join(osenv.home(), '.remtail.json');
var DEFAULT_SSH_CONFIG = path.join(osenv.home(), '.ssh/config');


function main() {
    program
        .version(packageJson.version)
        .usage('remtail [options] <hostname1>:</path/to/file> <hostname2>:</path/to/file>')
        .option('-c, --credentials', 'Path to credentials file')
        .option('-s, --sshconfig', 'Path to ssh config file')
        .parse(process.argv);

    var hosts = hostUtils.buildHostMap(program.args);
    var credentialsMap = {};
    var sshConfigFilePath = program.sshconfig || DEFAULT_SSH_CONFIG;
    try {
        var sshConfig = fs.readFileSync(sshConfigFilePath, 'utf-8');
        var sshConfigCredentials = parseSshConfig(sshConfig);
        credentialsMap = credentialUtils.buildSshConfigCredentialsMap(credentialsMap, sshConfigCredentials);
    } catch (e) {
        console.log('Could not find or parse ' + sshConfigFilePath);
    }
    var credentialsFilePath = program.credentials || DEFAULT_CREDENTIALS_LOCATION;
    try {
        var credentialsFileString = fs.readFileSync(credentialsFilePath, 'utf-8');
        var credentialList = JSON.parse(credentialsFileString);
        credentialsMap = credentialUtils.addFileCredentials(credentialList);
    } catch (e) {
        console.log('Could not find or parse ' + credentialsFilePath);
    }
    hostUtils.addCredentials(hosts, credentialsMap);

    // open an ssh connection to every host and run the tail commands
    var connectionMap = {};
    var hostsSize = 0;
    for (var hostName in hosts) {
        hostsSize++;
        var host = hosts[hostName];

        for (var i in host.paths) {
            var file = host.paths[i];
            var tailCommand = "tail -F " + file;
            var displayPath = host.displayPaths[file];
            
            console.log('hostname: ' + hostName);
            console.log('command: ' + tailCommand);

            var conn = connectionMap[hostName] || new SshClient();

            // use bind to build a function that takes copies of local vars
            // from this particular iteration of the for loop
            var readyCallback = function(conn, tailCommand, hostName, displayPath) {
                var host = hosts[hostName];
                conn.exec(tailCommand, function(err, stream) {
                    if (err) {
                        throw err;
                    }

                    stream.on('close', function() {
                        console.log('Connected closed to: ' + hostName);
                        conn.end();
                    }).on('data', function(data) {
                        var dataString = data.toString('utf-8');
                        var lines = dataString.split('\n');
                        lines.forEach(function(line) {
                            if (line) {
                                console.log(colors[host.color](hostName + ' ' + displayPath) + ' ' + line);
                            }
                        });

                    }).stderr.on('data', function(data) {
                            var dataString = data.toString('utf-8');
                            var lines = dataString.split('\n');
                            lines.forEach(function(line) {
                                console.log(colors[host.color](hostName + ' ' + displayPath) + ' ' + line);
                            });
                        });
                });
            }.bind(this, conn, tailCommand, hostName, displayPath);
            conn.on('ready', readyCallback);
            
            if (!connectionMap[hostName]) {
                var connectionParams = {
                    host: hostName,
                    port: host.port,
                    username: host.user
                };

                if (!host.user) {
                    connectionParams.username = host.user =
                        readlineSync.question('Username for ' + hostName + ':\n');
                }

                // Authentication Method
                if (host.password) {
                    connectionParams.password = host.password;
                } else if (host.privateKey) {
                    connectionParams.privateKey = host.privateKey;
                    if (host.passphrase) {
                        connectionParams.passphrase = host.passphrase;
                    } else if (host.privateKey.indexOf('-----BEGIN RSA PRIVATE KEY-----') !== -1) {
                        connectionParams.passphrase = host.passphrase =
                            readlineSync.question('ssh key passphrase for ' + hostName + ':\n', {noEchoBack: true});
                    }
                } else {
                    var identifier = connectionParams.username + '@' + hostName;
                    connectionParams.password = host.password =
                        readlineSync.question('Password for ' + identifier + ':\n', {noEchoBack: true});
                }

                conn.on('error', function(connectionParams, error) {
                    if (error.level === 'client-socket') {
                        console.log('Could not connect to host ' + connectionParams.host);
                        process.exit(1);

                    } else if (error.level === 'client-authentication') {
                        console.log('Could not authenticate ' + connectionParams.username + '@' + connectionParams.host);
                    }
                }.bind(this, connectionParams));
                try {
                    conn.connect(connectionParams);
                } catch (e) {
                    console.log('Could not connect to ' + connectionParams.host);
                    if (e.toString().indexOf('Malformed private key') !== -1) {
                        console.log('Incorrect passphrase for private key.');
                    } else {
                        console.log(e.toString());
                    }
                    process.exit(1);
                }
                connectionMap[hostName] = conn;
            }
        }
    }
}


if (require.main === module) {
    main();
}