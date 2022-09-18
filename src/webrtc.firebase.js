import { WebRTCBase, WebRTCRole  } from "./webrtc.base";
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import fbc from './firebaseconfig';

const offer_collection_name = "sdp_offer";
const answer_collection_name = "sdp_answer";

export function offer(key, tracks){
    const firebase = initializeApp(fbc);
    const firestore = getFirestore(firebase);
    const webrtc = new WebRTCBase(WebRTCRole.offer, {
        async sendOfferSDP(sdp){
            console.debug('webrtc.firebase: sendOfferSDP called');
			await setDoc(doc(firestore, offer_collection_name, key), {
				sdp: sdp
			});
        },
    });

    const answer_doc = doc(firestore, answer_collection_name, key);
    const unsubscribe = onSnapshot(answer_doc, (document) => {
            const data = document.data();
            console.debug("onSnapshot: ", data);

            if(!data)
                return

            if(!data['sdp'])
                return

            // answer SDP を受信したら、firestore の変更通知を止める
            unsubscribe();
            // 受信して用済みなので firestore 上の answer SDP を削除
            deleteDoc(answerDocument);

            webrtc.receivedRemoteSDP(data['sdp']);
            // この時点で WebRTC の通信が始まって、peer に track が送信される
	});

    webrtc.startOffer(tracks);
    return webrtc;
}

export function answer(key, receivedMediaStreams){
    const firebase = initializeApp(fbc);
    const firestore = getFirestore(firebase);
    const webrtc = new WebRTCBase(WebRTCRole.answer, {
        async sendAnswerSDP(sdp){
            console.debug('webrtc.firebase: sendOfferSDP called');
			await setDoc(doc(firestore, answer_collection_name, key), {
				sdp: sdp
			});
        },
        receivedMediaStreams,
    });

    const offerDocument = doc(firestore, offer_collection_name, key);
	var unsubscribe = onSnapshot(offerDocument, (document) => {
		const data = document.data();
		console.debug("onSnapshot: ", data);

		if(!data)
			return

		if(!data['sdp'])
			return

		// offer SDP を受信したら、firestore の変更通知を止める
		unsubscribe();
		// 受信して用済みなので firestore 上の offer SDP を削除
		deleteDoc(offerDocument);

        webrtc.receivedRemoteSDP(data['sdp']);
		// この時点で受信側の ICE の収集が走り始め、完了したら sendAnswerSDP() がキックされる
	});
}