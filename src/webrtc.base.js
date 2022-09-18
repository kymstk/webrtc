export const WebRTCRole = Object.freeze({
    offer: Symbol('offer'),
    answer: Symbol('answer'),
});

export class WebRTCBase{
    /*
        step0: on offer side, set tracks and create and set description
        step1: on offer side, when ice gathering completed, send SDP to answer side
        step2: on answer side, recieve offer SDP and set it to RTCPeerConnection, and create and set description
        step3: on answer side, when ice gathering completed, send SDP to offer side
        step4: on offer side, recieve answer SDP and set it to RTCPeerConnection.
    */
    constructor(role, callbacks){
        if(role == WebRTCRole.offer){
            if( !['sendOfferSDP', ].every((f) => f in callbacks) )
                throw "some callbacks needed for offer side are missing";
        }else{
            if( !['sendAnswerSDP', ].every((f) => f in callbacks) )
                throw "some callbacks needed for answer side are missing";
        }

        this.role = role;
        this.callbacks = callbacks;
        this.connection = new RTCPeerConnection();

        this.connection.onicegatheringstatechange = () => {
            if(this.connection.iceGatheringState != "complete")
                return;

            if(this.role == WebRTCRole.offer){
                // step 1
                this.callbacks.sendOfferSDP(this.connection.localDescription['sdp']);
            }
            else{
                // step 3
                this.callbacks.sendAnswerSDP(this.connection.localDescription['sdp'])
            }
        };

        this.connection.ontrack = (ev) =>{
            console.debug('WebRTCBase: ontrack callback:', ev);

            if(! ('receivedMediaStreams' in this.callbacks) )
                return;

            if (ev.streams && ev.streams.length > 0) {
                callbacks.receivedMediaStreams(ev.streams);
            } else {
                const mediastream = new MediaStream();
                mediastream.addTrack(ev.track);
                callbacks.receivedMediaStreams([mediastream]);
            }
        }
    }

    startOffer(...tracks){
        // step 0
        if(tracks.length == 0)
            throw "Error: least one track is needed for offer";

        tracks = tracks.flat(3);

        // peer に送信する track を RTCPeerConnection に登録
        tracks.forEach((e) => this.connection.addTrack(e))

        // offer SDP を取得して、RTCPeerConnection に登録
        // この時点で送信側の ICE の収集が走り始め、完了したらイベントハンドラがキックされる
        this.connection.createOffer().then(desc => this.connection.setLocalDescription(desc))
    }

    receivedRemoteSDP(sdp){
        if(this.role == WebRTCRole.answer){
            // step2
            const remoteDesc = new RTCSessionDescription({ sdp: sdp, type: 'offer' })
            this.connection.setRemoteDescription(remoteDesc)

            // answer SDP を作成して、RTCPeerConnection に登録
            // この時点で受信側の ICE の収集が走り始め、完了したら onicegatheringstatechange がキックされる
            this.connection.createAnswer().then(desc => this.connection.setLocalDescription(desc));
        }
        else{
            // step4
            const remoteDesc = new RTCSessionDescription({ sdp: sdp, type: 'answer' })
            this.connection.setRemoteDescription(remoteDesc)
        }
    }

    setOntrack(cb){
        this.connection.ontrack = cb;
    }
}