/**************************************************************************
    signaling.firestore.js is
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

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, Timestamp } from 'firebase/firestore';

const offer_collection_name = "description_offer";
const answer_collection_name = "description_answer";

export function createFirestoreSignaling(role, key, firebaseConfig){
    const firebase = initializeApp(firebaseConfig);
    const db = getFirestore(firebase);

    let collection_names = null;
    if(role.isOffer)
        collection_names = [offer_collection_name, answer_collection_name];
    else
        collection_names = [answer_collection_name, offer_collection_name];

    return {
        async sendDescription(description){
            console.debug('firestore signaling: sendOffer called');

			await setDoc(doc(db, collection_names[0], key), {
				type: description.type,
                sdp: description.sdp,
                lifelimit: Timestamp.fromMillis(Date.now() + 86400 * 1000), // 1日後, for TTL
			});
        },
        remoteDescription(){
            const peerdocument = doc(db, collection_names[1], key);

            return new Promise((resolve, reject) => {
                const unsubscribe = onSnapshot(peerdocument, (document) => {
                    const data = document.data();
                    console.debug("firestore signaling: snapshot:", data);

                    if(!data)
                        return

                    if( !('type' in data) )
                        return
                    if( !('sdp' in data) )
                        return

                    unsubscribe(); // firestore の変更通知を止める
                    deleteDoc(peerdocument); // 受信して用済みなので削除

                    resolve({type: data.type, sdp: data.sdp})
                });
            });
        },
    };
}