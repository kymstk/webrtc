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

export class HandyWebRTC{
    static #dclabel_sdp = '__sdp__exchange__';
    static #dclabel_trackid = '__remote_trackid__';
    static #datachannel_labels = [];
    static {
        this.#datachannel_labels.push(this.#dclabel_sdp);
        this.#datachannel_labels.push(this.#dclabel_trackid);
    }

    constructor(pc, sendAndReceiveDescription){
        this.rtcpc = pc;
        this.sendAndReceiveDescription = sendAndReceiveDescription;

        this.sdpchannel = null;
        this.trackidchannel = null;
        this.peerTrackIDs = {};
        this.peerTrackIDenquirys = {};

        // イベントロギング
        if('onconnectionstatechange' in this.rtcpc)
            this.rtcpc.addEventListener('connectionstatechange', (ev) =>{
                console.debug('HandyWebRTC: connection state change:', this.rtcpc.connectionState);
            });
        this.rtcpc.addEventListener('icecandidate', (ev) =>{
            console.debug('HandyWebRTC: icecandidate:', ev.candidate);
        });
        this.rtcpc.addEventListener('iceconnectionstatechange', (ev) =>{
            console.debug('HandyWebRTC: ice connection state change:', this.rtcpc.iceConnectionState);
        });
        this.rtcpc.addEventListener('icegatheringstatechange', (ev) =>{
            console.debug('HandyWebRTC: ice gathering state change:', this.rtcpc.iceGatheringState);
        });
        this.rtcpc.addEventListener('signalingstatechange', (ev) =>{
            console.debug('HandyWebRTC: signaling state change:', this.rtcpc.signalingState);
        });
        this.rtcpc.addEventListener('datachannel', (ev) =>{
            console.debug('HandyWebRTC: datachannel:', ev);
        });
        this.rtcpc.addEventListener('track', (ev) =>{
            console.debug('HandyWebRTC: track:', ev);
        });
    }

    _getWaiterForIceGatheringComplete(){
        return new Promise((successed) => {
            const onicegatheringstatechange = () => {
                if(this.rtcpc.iceGatheringState != "complete")
                    return;

                this.rtcpc.removeEventListener('icegatheringstatechange', onicegatheringstatechange);

                successed();
            };
            this.rtcpc.addEventListener('icegatheringstatechange', onicegatheringstatechange);
        });
    }

    _setupDataChannels(){
        if(this.sdpchannel == null){
            // 接続の確立後、SDP を再交換する際に使う datachannel
            this.sdpchannel = this.rtcpc.createDataChannel(
                HandyWebRTC.#dclabel_sdp, {
                    id: HandyWebRTC.#datachannel_labels.indexOf(HandyWebRTC.#dclabel_sdp),
                    negotiated: true,
                }
            );

            const onnegotiationneeded = async (ev) => {
                // some track or data channel was added = offer side
                console.debug('HandyWebRTC: negotiation needed:');

                await this.rtcpc.setLocalDescription();
                this.sdpchannel.send(JSON.stringify(this.rtcpc.localDescription));
            };
            this.sdpchannel.onopen = (ev) => {
                this.rtcpc.addEventListener('negotiationneeded', onnegotiationneeded);
            };
            this.sdpchannel.onclosing = (ev) => {
                this.rtcpc.removeEventListener('negotiationneeded', onnegotiationneeded);
                this.sdpchannel = null;
            };
            this.sdpchannel.onmessage = async (ev) => {
                console.debug('HandyWebRTC: sdpchannel.onmeesage:', ev);
                const remoteDesc = new RTCSessionDescription(JSON.parse(ev.data));
                await this.rtcpc.setRemoteDescription(remoteDesc);

                if('offer' == remoteDesc.type){
                    // answer side
                    await this.rtcpc.setLocalDescription();
                    this.sdpchannel.send(JSON.stringify(this.rtcpc.localDescription));
                }
            };
        }
        if(this.trackidchannel == null){
            // 接続の確立後、SDP を再交換する際に使う datachannel
            this.trackidchannel = this.rtcpc.createDataChannel(
                HandyWebRTC.#dclabel_trackid, {
                    id: HandyWebRTC.#datachannel_labels.indexOf(HandyWebRTC.#dclabel_trackid),
                    negotiated: true,
                }
            );
            this.trackidchannel.onclosing = (ev) => {
                this.trackidchannel = null;
            }
            this.trackidchannel.onmessage = (ev) => {
                console.debug('HandyWebRTC: trackidchannel.onmeesage:', ev);
                const message = JSON.parse(ev.data);

                if(message.type == 'enquiry'){
                    const receiver = this.rtcpc.getTransceivers().find(el => el.mid == message.mid);
                    const response = {
                        type: 'answer',
                        mid: message.mid,
                        enquirytrackid: message.trackid,
                    }
                    if(receiver){
                        response['answertrackid'] = receiver.sender.track.id;
                    }else{
                        response['error'] = "I don't have enqueried media: trackid = " + message.trackid;
                    }
                    this.trackidchannel.send(JSON.stringify(response));
                }
                else if(message.type == 'answer'){
                    if('error' in message){
                        const failed = this.peerTrackIDenquirys[message.enquirytrackid][1];
                        failed(message.error);
                    }else{
                        const successed = this.peerTrackIDenquirys[message.enquirytrackid][0];
                        this.peerTrackIDs[message.enquirytrackid] = message.answertrackid;
                        successed(message.answertrackid);
                    }

                    delete this.peerTrackIDenquirys[message.enquirytrackid];
                }
            }
        }
    }

    async makeoffer(){
        const waitIceGatheringComplete = this._getWaiterForIceGatheringComplete();

        this._setupDataChannels();

        await this.rtcpc.setLocalDescription(); // kick ice gathering

        await waitIceGatheringComplete;

        const remoteDesc = await this.sendAndReceiveDescription(this.rtcpc.localDescription);
        await this.rtcpc.setRemoteDescription(new RTCSessionDescription(remoteDesc));
    }

    async answerTo(remoteDesc){
        const waitIceGatheringComplete = this._getWaiterForIceGatheringComplete();

        this._setupDataChannels();

        await this.rtcpc.setRemoteDescription(new RTCSessionDescription(remoteDesc));

        await this.rtcpc.setLocalDescription(); // kick ice gathering

        await waitIceGatheringComplete;

        return this.rtcpc.localDescription;
    }

    getRemoteTrackIDfor(trackid){
        if(trackid in this.peerTrackIDs){
            return this.peerTrackIDs[trackid];
        }

        if(! this.trackidchannel || this.trackidchannel.readyState != 'open'){
            throw 'trackid enquir channeld is not open yet'
        }

        const receiver = this.rtcpc.getTransceivers().find(el => el.receiver.track.id == trackid);
        if(! receiver)
            throw 'No receiver is found for trackid: ' + trackid;

        const answer = new Promise((successed, failed) =>{
            this.peerTrackIDenquirys[trackid] = [successed, failed];
        })

        const request = {
            type: 'enquiry',
            mid: receiver.mid,
            trackid: trackid,
        };
        this.trackidchannel.send(JSON.stringify(request));

        return answer;
    }
}