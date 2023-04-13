import React, { Component } from 'react';
import { Container } from 'reactstrap';
import { getTokenOrRefresh } from './token_util';
import './custom.css'
import { ResultReason } from 'microsoft-cognitiveservices-speech-sdk';

const speechsdk = require('microsoft-cognitiveservices-speech-sdk')

const DID_API = {
    "key": "ZXJpY2hhbjIwNDhAZ21haWwuY29t:g2uaSCsvaWkgzhFv0cNVJ",
    "url": "https://api.d-id.com"
}
let peerConnection;
let streamId;
let sessionId;
let sessionClientAnswer;

let audioURL;

export default class App extends Component {
    peerStatusLabel;
    iceStatusLabel;
    iceGatheringStatusLabel;
    signalingStatusLabel;

    constructor(props) {
        super(props);

        this.state = {
            displayText: 'INITIALIZED: ready to test speech...'
        }

    }
    async componentDidMount() {
        // check for valid speech key/region
        const tokenRes = await getTokenOrRefresh();
        if (tokenRes.authToken === null) {
            this.setState({
                displayText: 'FATAL_ERROR: ' + tokenRes.error
            });
        }
        document.getElementById('talk-video').setAttribute('playsinline', '');
    }

    async sttFromMic() {
        const tokenObj = await getTokenOrRefresh();
        const speechConfig = speechsdk.SpeechConfig.fromAuthorizationToken(tokenObj.authToken, tokenObj.region);
        speechConfig.speechRecognitionLanguage = 'en-US';

        const audioConfig = speechsdk.AudioConfig.fromDefaultMicrophoneInput();
        const recognizer = new speechsdk.SpeechRecognizer(speechConfig, audioConfig);

        this.setState({
            displayText: 'speak into your microphone...'
        });

        recognizer.recognizeOnceAsync(async result => {
            let displayText;
            if (result.reason === ResultReason.RecognizedSpeech) {
                displayText = `RECOGNIZED: Text=${result.text}`

                fetch(`http://172.20.10.2:9001/textVoice?text=${result.text}&key=${DID_API.key}`,
                {
                    method: 'POST',
                    headers: { 'accept': 'application/json' },
                    body: ''
                }).then(res => {
                    res.json().then(data => {
                        console.log("gpt response: ", data);
                        audioURL = data.url;
                        this.talkBtnClick()
                    });
                }).catch(err => {
                    console.log("gpt response err: ", err);
                });
            } else {
                displayText = 'ERROR: Speech was cancelled or could not be recognized. Ensure your microphone is working properly.';
            }

            this.setState({
                displayText: displayText
            });
        });
    }

    async fileChange(event) {
        const audioFile = event.target.files[0];
        console.log(audioFile);
        const fileInfo = audioFile.name + ` size=${audioFile.size} bytes `;

        this.setState({
            displayText: fileInfo
        });

        const tokenObj = await getTokenOrRefresh();
        const speechConfig = speechsdk.SpeechConfig.fromAuthorizationToken(tokenObj.authToken, tokenObj.region);
        speechConfig.speechRecognitionLanguage = 'en-US';

        const audioConfig = speechsdk.AudioConfig.fromWavFileInput(audioFile);
        const recognizer = new speechsdk.SpeechRecognizer(speechConfig, audioConfig);

        recognizer.recognizeOnceAsync(result => {
            let displayText;
            if (result.reason === ResultReason.RecognizedSpeech) {
                displayText = `RECOGNIZED: Text=${result.text}`
            } else {
                displayText = 'ERROR: Speech was cancelled or could not be recognized. Ensure your microphone is working properly.';
            }

            this.setState({
                displayText: fileInfo + displayText
            });
        });
    }

    async talkBtnClick() {
        
        if (peerConnection?.signalingState === 'stable' || peerConnection?.iceConnectionState === 'connected') {
            console.log("audioURL: ", audioURL);
            const talkResponse = await fetch(`${DID_API.url}/talks/streams/${streamId}`,
                {
                    method: 'POST',
                    headers: { Authorization: `Basic ${DID_API.key}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'script': {
                            'type': 'audio',
                            'audio_url': audioURL
                        },
                        'driver_url': 'bank://lively/',
                        'config': {
                            'stitch': true,
                        },
                        'session_id': sessionId
                    })
                }).then(res => {
                    console.log("talkResponse: ", res);
                }).catch(err => {
                    console.log("talkResponse err: ", err);
                });
        }
        // const inputText = document.getElementById("textInput").value;
        // const talkResponse = await fetch(`${DID_API.url}/talks/streams/${streamId}`,
        //     {
        //         method: 'POST',
        //         headers: { Authorization: `Basic ${DID_API.key}`, 'Content-Type': 'application/json' },
        //         body: JSON.stringify({
        //             'script': {
        //                 'type': 'text',
        //                 'provider': {'type': 'microsoft', 'voice_id': 'Jenny'},
        //                 'input': inputText,
        //                 'ssml': 'false'
        //               },
        //             // 'config': {'fluent': 'false', 'pad_audio': '0.0'},
        //             // 'driver_url': 'bank://lively/',
        //             // 'sessionId': sessionId
        //         }),
        //     }).then(res => {
        //         console.log("talkResponse: ", res);
        //     }).catch(err => {
        //         console.log("talkResponse err: ", err);
        //     });
        // }
    }

    async connectBtnClick() {
        console.log("connectBtnClick");

        if (peerConnection && peerConnection.connectionState === 'connected') {
            return;
        }

        this.stopAllStreams();
        this.closePC();

        const sessionResponse = await fetch(`${DID_API.url}/talks/streams`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${DID_API.key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                source_url: "https://d-id-public-bucket.s3.amazonaws.com/or-roman.jpg"
            }),
        });


        const { id: newStreamId, offer, ice_servers: iceServers, session_id: newSessionId } = await sessionResponse.json()
        streamId = newStreamId;
        sessionId = newSessionId;

        try {
            sessionClientAnswer = await this.createPeerConnection(offer, iceServers);
        } catch (e) {
            console.log('error during streaming setup', e);
            this.stopAllStreams();
            this.closePC();
            return;
        }

        //return a session description
        const sdpResponse = await fetch(`${DID_API.url}/talks/streams/${streamId}/sdp`,
            {
                method: 'POST',
                headers: { Authorization: `Basic ${DID_API.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ answer: sessionClientAnswer, session_id: sessionId })
            }).then(res => {
                console.log("sdpResponse: ", res);
            }).catch(err => {
                console.log("sdpResponse err: ", err);
            });
    }

    stopAllStreams() {
        if (document.getElementById('talk-video').srcObject) {
            console.log('stopping video streams');
            document.getElementById('talk-video').srcObject.getTracks().forEach(track => track.stop());
            document.getElementById('talk-video').srcObject = null;
        }
    }

    closePC(pc = peerConnection) {
        if (!pc) return;
        console.log('stopping peer connection');
        pc.close();
        pc.removeEventListener('icegatheringstatechange', this.onIceGatheringStateChange, true);
        pc.removeEventListener('icecandidate', this.onIceCandidate, true);
        pc.removeEventListener('iceconnectionstatechange', this.onIceConnectionStateChange, true);
        pc.removeEventListener('connectionstatechange', this.onConnectionStateChange, true);
        pc.removeEventListener('signalingstatechange', this.onSignalingStateChange, true);
        pc.removeEventListener('track', this.onTrack, true);
        document.getElementById('ice-gathering-status-label').innerText = '';
        document.getElementById('signaling-status-label').innerText = '';
        document.getElementById('ice-status-label').innerText = '';
        document.getElementById('peer-status-label').innerText = '';
        console.log('stopped peer connection');
        if (pc === peerConnection) {
            peerConnection = null;
        }
    }

    async createPeerConnection(offer, iceServers) {
        if (!peerConnection) {
            peerConnection = new RTCPeerConnection({ iceServers });
            peerConnection.addEventListener('icegatheringstatechange', this.onIceGatheringStateChange, true);
            peerConnection.addEventListener('icecandidate', this.onIceCandidate, true);
            peerConnection.addEventListener('iceconnectionstatechange', this.onIceConnectionStateChange, true);
            peerConnection.addEventListener('connectionstatechange', this.onConnectionStateChange, true);
            peerConnection.addEventListener('signalingstatechange', this.onSignalingStateChange, true);
            peerConnection.addEventListener('track', this.onTrack, true);
        }

        await peerConnection.setRemoteDescription(offer);
        console.log('set remote sdp OK');

        const sessionClientAnswer = await peerConnection.createAnswer();
        console.log('create local sdp OK');

        await peerConnection.setLocalDescription(sessionClientAnswer);
        console.log('set local sdp OK');

        return sessionClientAnswer;
    }


    onIceGatheringStateChange() {
        document.getElementById('ice-gathering-status-label').innerText = peerConnection.iceGatheringState;
        document.getElementById('ice-gathering-status-label').className = 'iceGatheringState-' + peerConnection.iceGatheringState;
    }
    onIceCandidate(event) {
        console.log('onIceCandidate', event);
        if (event.candidate) {
            const { candidate, sdpMid, sdpMLineIndex } = event.candidate;

            fetch(`${DID_API.url}/talks/streams/${streamId}/ice`,
                {
                    method: 'POST',
                    headers: { Authorization: `Basic ${DID_API.key}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ candidate, sdpMid, sdpMLineIndex, session_id: sessionId })
                });
        }
    }
    onIceConnectionStateChange() {
        document.getElementById('ice-status-label').innerText = peerConnection.iceConnectionState;
        document.getElementById('ice-status-label').className = 'iceConnectionState-' + peerConnection.iceConnectionState;
        if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'closed') {
            this.stopAllStreams();
            this.closePC();
        }
    }

    onConnectionStateChange() {
        // not supported in firefox
        document.getElementById('peer-status-label').innerText = peerConnection.connectionState;
        document.getElementById('peer-status-label').className = 'peerConnectionState-' + peerConnection.connectionState;
    }
    onSignalingStateChange() {
        document.getElementById('signaling-status-label').innerText = peerConnection.signalingState;
        document.getElementById('signaling-status-label').className = 'signalingState-' + peerConnection.signalingState;
    }
    onTrack(event) {
        const remoteStream = event.streams[0];
        // this.setVideoElement(remoteStream);
        document.getElementById('talk-video').srcObject = remoteStream;
    }
    setVideoElement(stream) {
        if (!stream) return;
        document.getElementById('talk-video').srcObject = stream;

        // safari hotfix
        if (document.getElementById('talk-video').paused) {
            document.getElementById('talk-video').play().then(_ => { }).catch(e => { });
        }
    }

    testClick() {
        fetch(`http://172.20.10.2:9001/textVoice?text=Tell%20me%20a%20joke.&key=anVseTJ0aEAxNjMuY29t:WTUy0GrLGiGoXx8l7VFzy`,
            {
                method: 'POST',
                headers: { 'accept': 'application/json' },
                body: ''
            }).then(res => {
                res.json().then(data => {
                    console.log("gpt response: ", data);
                });
            }).catch(err => {
                console.log("gpt response err: ", err);
            });
    }

    render() {
        return (
            <Container className="app-container">
                <h1 className="display-4 mb-3">AI Avatar Demo</h1>

                <div className="row main-container">
                    <div className="col-6">
                        <i className="fas fa-microphone fa-lg mr-2" onClick={() => this.sttFromMic()}></i>
                        Convert speech to text from your mic.

                        {/* <div className="mt-2">
                            <label htmlFor="audio-file"><i className="fas fa-file-audio fa-lg mr-2"></i></label>
                            <input
                                type="file"
                                id="audio-file"
                                onChange={(e) => this.fileChange(e)}
                                style={{ display: "none" }}
                            />
                            Convert speech to text from an audio file.
                        </div> */}
                    </div>
                    <div className="col-6 output-display rounded">
                        <code>{this.state.displayText}</code>
                    </div>

                    <div className='col-12 d-id-content'>

                        <div id="video-wrapper">
                            <div>
                                <video id="talk-video" width="400" height="400" autoPlay></video>
                            </div>
                        </div>

                        {/* <div>
                            <input type="text" id="textInput"></input>
                        </div> */}

                        <div id="buttons">
                            <button id="connect-button" type="button" onClick={() => this.connectBtnClick()}>Connect</button>
                            <button id="talk-button" type="button" onClick={() => this.talkBtnClick()}>Start</button>
                            <button id="destroy-button" type="button">Clear</button>
                            <button id="test" type="button" onClick={() => this.testClick()}>test</button>
                        </div>

                        <div id="status">
                            ICE gathering status: <label id="ice-gathering-status-label"></label>
                            <div></div>
                            ICE status: <label id="ice-status-label"></label>
                            <div></div>
                            Peer connection status: <label id="peer-status-label"></label>
                            <div></div>
                            Signaling status: <label id="signaling-status-label"></label>
                        </div>
                    </div>
                </div>

            </Container>

        );
    }
}