// picoExtension.js
// Shane M. Clements, February 2014
// PicoBoard Scratch Extension
//
// This is an extension for development and testing of the Scratch Javascript Extension API.

(function (ext) {
    var device = null;
    var rawData = null;
    
    //Number of byte pairs transmitted per query response
    var messageLength = 8;

    // Sensor states:
    var channels = {
        EXT2: {channel: 0, value: null, sensitivity: false},
        EXT1: {channel: 1, value: null, sensitivity: false},
        D: {channel: 2, value: null, sensitivity: false},
        C: {channel: 3, value: null, sensitivity: false},
        B: {channel: 4, value: null, sensitivity: false},
        A: {channel: 5, value: null, sensitivity: false},
        button: {channel: 6, value: null}
    };
    
    //TODO: generate programatically
    var channelLookup = ['EXT2', 'EXT1', 'D', 'C', 'B', 'A', 'button', 'id'];
    
    var extraDevices = {
      ultrasound: null
    };
    
    // Array of arrays!
    var commandQueue = [];

    ext.resetAll = function (){};

    // Hats / triggers
    ext.whenSensorConnected = function (which) {
        return getSensorPressed(which);
    };

    ext.whenSensorPass = function (which, sign, level) {
        if (sign === '<') return getSensor(which) < level;
        return getSensor(which) > level;
    };

    // Reporters
    ext.sensorPressed = function (which) {
        return getSensorPressed(which);
    };

    ext.sensor = function (which) {
        return getSensor(which);
    };
    
    ext.read = function (sensitivity, which, callback) {
        readScaled(sensitivity === 'sensitive', which, callback);
    };
    
    ext.readResistance = function (sensitivity, which, callback) {
        readResistance(sensitivity === 'sensitive', which, callback);
    };
    
    //TODO: Make min() calls out of function!
    ext.firstSegmentDisplay = function (num, callback) {
        writeDisplay(Math.min(num, 9), 1, callback);
    };
    
    ext.secondSegmentDisplay = function (num, callback) {
        writeDisplay(Math.min(num, 9), 2, callback);   
    };
    
    ext.twoDigitSegmentDisplay = function (num, callback) {
        writeDisplay(Math.min(num, 100), 3, callback);   
    };
    
    ext.clearDisplays = clearDisplays;
    
    ext.ultrasound = ultrasound;

    // Private logic
    function getSensorPressed(which) {
        if (device === null) return false;
        if (which === 'button pressed' && getSensor('button') < 1) return true;
        if (which === 'A connected' && getSensor('A') < 10) return true;
        if (which === 'B connected' && getSensor('B') < 10) return true;
        if (which === 'C connected' && getSensor('C') < 10) return true;
        if (which === 'D connected' && getSensor('D') < 10) return true;
        return false;
    }

    function getSensor(which) {
        if (which === 'light') {
            return getLightSensor();
        } else if (which === 'dial') {
            return scaleSensor(channels.EXT1.value);
        } else {
            return scaleSensor(channels[which].value);
        }
    }

    function readPoll(sensitivity, which, callback) {
        // If already in the right sensitivity mode we're good to go!
        if (channels[which].sensitivity === sensitivity) {
            callback(); 
        } else {
            // Switch sensitivity mode and wait to test.
            // Keep spamming in case of packet loss
            switchSensitivity(which, sensitivity);
            setTimeout(function () {
                readPoll(sensitivity, which, callback);
            }, 100);
        }
    }
    
    function readScaled(sensitivity, which, callback) {
        function report() {
            callback(scaleSensor(channels[which].value));
        }
        
        readPoll(sensitivity, which, report);
    }
    
    function readResistance(sensitivity, which, callback) {
        function report() {
            // Value of resistors in resistive divider
            var resistance = (sensitivity === 'normal') ? 10 : 1000 + 10,
                vIn = 5,
                vOut = channels[which].value / 1023 * 5;
            
            callback(resistance / (vIn / vOut - 1));
        }
        
        readPoll(sensitivity, which, report);
    }
    
    function switchSensitivity(which, sensitivity) { 
        enqueueCommand([(1 << 7) | ((sensitivity ? 1 : 0) << 3) | channels[which].channel]);
    }
    
    function scaleSensor(value) {
        return (100 * value) / 1023; 
    }
    
    function getLightSensor() {
        var v = channels.EXT2.value;
        return (v < 25) ? 100 - v : Math.round((1023 - v) * (75 / 998));
    }
    
    function writeDisplay(num, display, callback) {
        // display 1 == 1st, display 2 == 2nd, display 3 == both
        // following byte == number to display
        // Don't try to write 2s compliment negative numbers!
        enqueueCommand([display | 0x40, Math.max(0, num)], callback);
    }
    
    function clearDisplays(callback) {
        // display 4 == clear (no following byte)
        enqueueCommand([0x40 | 4], callback);
    }
    
    function enqueueCommand(commandArray, callback) {
      commandQueue.push([commandArray, callback]);
    }
    
    function ultrasound(callback) {
      enqueueCommand([0xC0], function () {
        callback(extraDevices.ultrasound);
      });
    }

    function processData() {
        var bytes = new Uint8Array(rawData);

        var messageTypeId = null;
        
        var tempDeviceVal = null;

        // TODO: make this robust against misaligned packets.
        // Right now there's no guarantee that our 18 bytes start at the beginning of a message.
        // Maybe we should treat the data as a stream of 2-byte packets instead of 18-byte packets.
        // That way we could just check the high bit of each byte to verify that we're aligned.
        for (var i = 0; i < messageLength; ++i) {
            var hb = bytes[i * 2] & 0x7F;
            var channel = (hb >> 3) & 0x07;
            var lb = bytes[(i * 2) + 1] & 0x7F;
            var value = ((hb & 0x07) << 7) + lb;
            
            if (channelLookup[channel] === 'id') {
                // Deal with magic id channel that doesn't correspond to an actual input
                messageTypeId = value;
                continue;
            }
            // first 2 byte pairs give device value.  1 byte payload per byte pair message.
            if (messageTypeId && messageTypeId !== 0x01) {
              if (i === 1) {
                tempDeviceVal = value << 8;
              }
              if (i === 2) {
                tempDeviceVal |= value;
                if (messageTypeId === 0x02) {
                  // Ultrasound
                  extraDevices.ultrasound = tempDeviceVal;
                }
              }
            }
            channels[channelLookup[channel]].sensitivity = !!(hb >> 6);
            channels[channelLookup[channel]].value = value;
        }

        if (watchdog && messageTypeId === 0x01) {
            // Seems to be a valid PicoBoard.
            clearTimeout(watchdog);
            watchdog = null;
        }

        //console.log(inputs);
        rawData = null;
    }

    function appendBuffer(buffer1, buffer2) {
        var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
        tmp.set(new Uint8Array(buffer1), 0);
        tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
        return tmp.buffer;
    }

    // Extension API interactions
    var potentialDevices = [];
    ext._deviceConnected = function (dev) {
        potentialDevices.push(dev);

        if (!device) {
            tryNextDevice();
        }
    };

    var poller = null;
    var watchdog = null;
    function tryNextDevice() {
        // If potentialDevices is empty, device will be undefined.
        // That will get us back here next time a device is connected.
        device = potentialDevices.shift();
        console.log('trying...');
        console.log(device);
        if (device) {
            device.open({stopBits: 0, bitRate: 38400, ctsFlowControl: 0}, function (dev) {
            
                if (!dev) {
                    tryNextDevice();
                    return;
                }
            
                device.set_receive_handler(function (data) {
                    //console.log('Received: ' + data.byteLength);
                    if (!rawData || rawData.byteLength === messageLength * 2) {
                        rawData = new Uint8Array(data);
                    }
                    else rawData = appendBuffer(rawData, data);

                    if (rawData.byteLength >= messageLength * 2) {
                        //console.log(rawData);
                        processData();
                        //device.send(pingCmd.buffer);
                    }
                });

                // Tell the PicoBoard to send a input data every 50ms
                poller = setInterval(function () {
                    // If we've a command to send, do so, else send normal ping
                    var nextInQueue,
                        queuedCmd,
                        pingCmd;
                    
                    if (nextInQueue = commandQueue.shift()) {
                        queuedCmd = nextInQueue[0];
                        //Do callback
                        nextInQueue[1]();
                    }
                    pingCmd = new Uint8Array(queuedCmd || [0x02]);
                    device.send(pingCmd.buffer);
                }, 50);
                watchdog = setTimeout(function () {
                    // This device didn't get good data in time, so give up on it. Clean up and then move on.
                    // If we get good data then we'll terminate this watchdog.
                    clearInterval(poller);
                    commandQueue = [];
                    poller = null;
                    device.set_receive_handler(null);
                    device.close();
                    device = null;
                    tryNextDevice();
                }, 2000);
            });
        }
    }

    ext._deviceRemoved = function (dev) {
        if (device != dev) {
            return;
        }
        if (poller) {
            poller = clearInterval(poller);
        }
        device = null;
    };

    ext._shutdown = function () {
        if (device) {
            device.close();
        }
        if (poller) {
            poller = clearInterval(poller);
        }
        device = null;
    };

    ext._getStatus = function () {
        if (!device) {
            return {status: 1, msg: 'ExperiSense disconnected'};
        }
        if (watchdog) {
            return {status: 1, msg: 'Probing for ExperiSense'};
        }
        return {status: 2, msg: 'ExperiSense connected'};
    };

    var descriptor = {
        blocks: [
            ['h', 'when %m.booleanSensor', 'whenSensorConnected', 'button pressed'],
            ['h', 'when %m.resistanceAndSensor %m.lessMore %n', 'whenSensorPass', 'dial', '>', 50],
            ['b', 'sensor %m.booleanSensor?', 'sensorPressed', 'button pressed'],
            ['-'],
            ['r', '%m.sensor sensor value', 'sensor', 'dial'],
            ['r', '%m.ext value', 'sensor', 'EXT1'],
            ['R', '%m.sensitivity read from %m.resistance', 'read', 'normal', 'A'],
            ['R', '%m.sensitivity read resistance from %m.resistance (kΩ)', 'readResistance', 'normal', 'A'],
            ['-'],
            ['w' , 'show %n on first display', 'firstSegmentDisplay', 1],
            ['w', 'show %n on second display', 'secondSegmentDisplay', 1],
            ['w', 'display 0–100 number %n', 'twoDigitSegmentDisplay', 10],
            ['w', 'clear displays', 'clearDisplays'],
            ['-'],
            ['R', 'ultrasound echo time (µs)', 'ultrasound']
        ],
        menus: {
            booleanSensor: ['button pressed', 'A connected', 'B connected', 'C connected', 'D connected'],
            sensor: ['dial', 'light'],
            resistance: ['A', 'B', 'C', 'D'],
            ext: ['EXT1', 'EXT2'],
            get port() { return this.resistance.concat(this.ext); },
            lessMore: ['>', '<'],
            sensitivity: ['normal', 'sensitive'],
            get resistanceAndSensor() { return this.sensor.concat(this.resistance); }
        },
        //TODO: update URL
        url: '/info/help/studio/tips/ext/PicoBoard/'
    };
    ScratchExtensions.register('ExperiSense', descriptor, ext, {type: 'serial'});
})({});
