/**************************************************************************
    webrtc.js is
    Copyright (C) 2022 kymstk <kymstkpm+oss@gmail.com>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 **************************************************************************/

export const WebRTCRole = Object.freeze({
    offer: Object.freeze({
        isOffer: true,
        isAnswer: false,
    }),
    answer: Object.freeze({
        isOffer: false,
        isAnswer: true,
    }),
});

export class WebRTCBase extends RTCPeerConnection{
    static #sdpdatachannellabel = '__sdp__exchange__';
    static #sdpdatachanneloptions = {
        id: 0,
        negotiated: true,
    };

    /*
        step0: on offer side, set tracks and create and set description
        step1: on offer side, when ice gathering completed, send SDP to answer side
        step2: on answer side, recieve offer SDP and set it to RTCPeerConnection, and create and set description
        step3: on answer side, when ice gathering completed, send SDP to offer side
        step4: on offer side, recieve answer SDP and set it to RTCPeerConnection.
    */
    constructor(role, signaling){
        if( !['sendDescription', 'remoteDescription'].every((f) => f in signaling) )
            throw "some callbacks needed are missing";

        super();

        this.role = role;
        this.signaling = signaling

        // イベントロギング
        if('onconnectionstatechange' in this)
            this.addEventListener('connectionstatechange', (ev) =>{
                console.debug('RTCPeerConnection: connection state change:', this.connectionState);
            });
        this.addEventListener('icecandidate', (ev) =>{
            console.debug('RTCPeerConnection: icecandidate:', ev.candidate);
        });
        this.addEventListener('iceconnectionstatechange', (ev) =>{
            console.debug('RTCPeerConnection: ice connection state change:', this.iceConnectionState);
        });
        this.addEventListener('icegatheringstatechange', (ev) =>{
            console.debug('RTCPeerConnection: ice gathering state change:', this.iceGatheringState);
        });
        this.addEventListener('signalingstatechange', (ev) =>{
            console.debug('RTCPeerConnection: signaling state change:', this.signalingState);
        });
        this.addEventListener('datachannel', (ev) =>{
            console.debug('RTCPeerConnection: datachannel:', ev);
        });
        this.addEventListener('track', (ev) =>{
            console.debug('RTCPeerConnection: track:', ev);
        });
    }

    async start(){
        const waitIceGatheringComplete = new Promise((successed) => {
            const onicegatheringstatechange = () => {
                if(this.iceGatheringState != "complete")
                    return;

                this.removeEventListener('icegatheringstatechange', onicegatheringstatechange);

                successed();
            };
            this.addEventListener('icegatheringstatechange', onicegatheringstatechange);
        });

        // 接続の確立後、SDP を再交換する際に使う datachannel
        this.sdpchannel = this.createDataChannel(WebRTCBase.#sdpdatachannellabel, WebRTCBase.#sdpdatachanneloptions);

        const onnegotiationneeded = async (ev) => {
            // some track or data channel was added = offer side
            console.debug('RTCPeerConnection: negotiation needed:');

            await this.setLocalDescription();
            this.sdpchannel.send(JSON.stringify(this.localDescription));
        };
        this.sdpchannel.onopen = (ev) => {
            this.addEventListener('negotiationneeded', onnegotiationneeded);
        };
        this.sdpchannel.onclosing = (ev) => {
            this.removeEventListener('negotiationneeded', onnegotiationneeded);
        };
        this.sdpchannel.onmessage = async (ev) => {
            const remoteDesc = new RTCSessionDescription(JSON.parse(ev.data));
            await this.setRemoteDescription(remoteDesc);

            if('offer' == remoteDesc.type){
                // answer side
                await this.setLocalDescription();
                this.sdpchannel.send(JSON.stringify(this.localDescription));
            }
        };

        if(this.role.isOffer){
            // kick ice gathering
            await this.setLocalDescription();

            await waitIceGatheringComplete;

            this.signaling.sendDescription({
                type: this.localDescription.type,
                sdp: this.localDescription.sdp,
            });
        }
        
        const remoteDesc = await this.signaling.remoteDescription();
        await this.setRemoteDescription(new RTCSessionDescription(remoteDesc));

        if(this.role.isAnswer){
            // kick ice gathering
            await this.setLocalDescription();

            await waitIceGatheringComplete;

            this.signaling.sendDescription({
                type: this.localDescription.type,
                sdp: this.localDescription.sdp,
            });
        }
    }
}