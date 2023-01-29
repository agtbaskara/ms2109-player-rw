const MODE_LIST = [
    // todo: re-evaluate mode list
    // 720p output isn't as clear as 1080p output, but the difference is small enough
    // to make prioritizing smoothness the more logical choice
    {width: 1280, height: 720, frameRate: 60},

    // Fallbacks
    {width: 1920, height: 1080, frameRate: 30},
    // MS2109 may output 25FPS when connected to a USB hub
    {width: 1920, height: 1080, frameRate: 25},
    {width: 1280, height: 720, frameRate: 30}
];

const AUDIO_META = {vid: '534d', pid: '2109', name: 'USB Digital Audio'};
const VIDEO_META = {vid: '534d', pid: '2109', name: 'USB Video'};

const videoElement = document.body.querySelector("video");
start().then();

async function requestMediaDevicePermission() {
    // request any media device to trigger the permission popup
    const stream = await window.navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
    });

    // stop all tracks so they can be requested again
    for (const track of stream.getTracks()) {
        track.stop();
    }
}

function findDevice(devices, type, meta) {
    // Spec doesn't define how to find a device with specified VID/PID
    // Chrome appends (vid:pid) to the device label
    let device = devices.find(
        x =>
            x.kind === type &&
            x.label.endsWith(`(${meta.vid.toLowerCase()}:${meta.pid.toLowerCase()})`));
    // look for friendly name if VID/PID not found
    if (device == null) {
        device = devices.find(
            x =>
                x.kind === type &&
                x.label.includes(meta.name));
    }
    return device;
}

async function start() {
    // Only `getUserMedia` triggers the permission popup, `enumerateDevices` won't
    await requestMediaDevicePermission();

    // TODO: handle permission rejected

    const devices = await window.navigator.mediaDevices.enumerateDevices();
    const videoDevice = findDevice(devices, 'videoinput', VIDEO_META);
    const audioDevice = findDevice(devices, 'audioinput', AUDIO_META);

    // TODO: handle device not found

    for (const mode of MODE_LIST) {
        try {
            const videoStream = await window.navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: {exact: videoDevice.deviceId},
                    width: {exact: mode.width},
                    height: {exact: mode.height},
                    frameRate: {exact: mode.frameRate},
                },
            });
            videoElement.srcObject = videoStream;

            // TODO: Warn about Firefox/Safari incompatibility
            const audioStream = await window.navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: {exact: audioDevice.deviceId},
                    sampleRate: 96_000,
                    sampleSize: 16,
                },
            });

            const context = new AudioContext({sampleRate: 96_000});
            const source = context.createMediaStreamSource(audioStream);
            await context.audioWorklet.addModule('data:application/javascript;charset=utf8,' + encodeURIComponent(`
            class SplitProcessor extends AudioWorkletProcessor {
              process (inputs, outputs, parameters) {
                const input = inputs[0][0];
                const leftOutput = outputs[0][0];
                const rightOutput = outputs[0][1];

                // Separate interleaved stereo audio into left and right channels
                let i = 0;
                while (i < input.length) {
                  // Web Audio API doesn't support sample rate conversion
                  // So we have to duplicate the samples
                  leftOutput[i] = input[i + 1];
                  leftOutput[i + 1] = input[i + 1];

                  rightOutput[i] = input[i];
                  rightOutput[i + 1] = input[i];

                  i += 2;
                }

                return true;
              }
            }

            registerProcessor('split-processor', SplitProcessor)
          `));
            const processor = new AudioWorkletNode(context, 'split-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
            });
            source.connect(processor);
            processor.connect(context.destination);

            // fullscreen mode
            document.addEventListener("keydown", function (e) {
                if (e.key === 'f') {
                    if (!document.fullscreenElement) {
                        videoElement.requestFullscreen();
                    } else {
                        if (document.exitFullscreen) {
                            document.exitFullscreen();
                        }
                    }
                }
            }, false);

            break;
        } catch (e) {
            console.error(e);
            // ignore
        }
    }
}