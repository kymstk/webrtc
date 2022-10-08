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

import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, Timestamp, collection } from 'firebase/firestore';

const top_collection = 'WebRTCSignaling';
const center_id = 'connection_center';

function generateSelfID(){
    return Math.random().toString(36).substring(2);
}
export class FirestoreSignaling {
    #firestore = null;
    #answerResolvs = {};

    constructor(key, offeredcallback, isCenter=false, appendix=undefined){
        this.isCenter = isCenter;
        this.key = key;
        if(isCenter)
            this.id = center_id;
        else
            this.id = generateSelfID();

        this.#firestore = getFirestore();

        this.appendix = appendix;

        if(isCenter){ // このセッションの有効期限を設定
            setDoc(doc(this.#firestore, top_collection, this.key),
                {
                    lifelimit: Timestamp.fromMillis(Date.now() + 86400 * 1000), // 1日後, for TTL
                }, {
                    merge: true,
                }
            );
        }

        const mycollection = collection(this.#firestore,
            top_collection, // collection
            this.key,            // document
            this.id              // collection
        );

        this.unsubscribe = onSnapshot(mycollection, (snapshot) => {
            snapshot.docChanges().forEach((changed) => {
                if(changed.type !== 'added')
                    return;
                
                const data = changed.doc.data();

                if(!data) return;
                if( !('type' in data)) return;
                if( !('sdp' in data)) return;

                console.debug('FirestoreSignaling: added document:', data.type, 'SDP from', changed.doc.id)

                if(data.type == 'offer'){
                    offeredcallback(changed.doc.id, data);
                }else{ // answer backed to my offer from peer
                    if( !(changed.doc.id in this.#answerResolvs)){
                        console.log('FirestoreSignaling: unknonw answer received from', changed.doc.id);
                        return;
                    }

                    this.#answerResolvs[changed.doc.id]({
                        description: {
                            type: data.type,
                            sdp: data.sdp,
                        },
                        appendix: data.appendix,
                        peerid: changed.doc.id,
                    });
                    delete this.#answerResolvs[changed.doc.id];
                }

                deleteDoc(changed.doc.ref);
            })
        })
    }

    getOfferSignalingToCenter(){
        return this.getOffersTo(center_id)
    }
    getOfferSignalingTo(peer){
        return (description) => {
            const retval = new Promise((resolve) => {
                this.#answerResolvs[peer] = resolve;
            });

            const document = doc(this.#firestore,
                top_collection, // collection
                this.key,            // document
                peer,                // collection
                this.id              // document
            );
            sendToPeer(document, description, this.appendix)

            return retval;
        };
    }

    answerTo(peer, description){
        const document = doc(this.#firestore,
            top_collection, // collection
            this.key,       // document
            peer,           // collection
            this.id         // document
        );

        return sendToPeer(document, description, this.appendix)
    }
}

function getFromPeer(peerdocument){
    return new Promise((resolve, failed) => {
        try{
            const unsubscribe = onSnapshot(peerdocument, (document) => {
                const data = document.data();
                console.debug("firestore signaling: snapshot:", data);

                if( !data ) return;
                if( !('type' in data) ) return;
                if( !('sdp' in data) ) return;

                unsubscribe(); // firestore の変更通知を止める
                deleteDoc(peerdocument); // 受信して用済みなので削除

                resolve({
                    description: {
                        type: data.type,
                        sdp: data.sdp,
                    },
                    appendix: data.appendix,
                    peerid: document.id,
                })
            });
        }catch(e){
            failed(e);
        }
    });
}

function sendToPeer(document, description, appendix){
    const data = {
        type: description.type,
        sdp: description.sdp,
    };
    if(appendix)
        data['appendix'] = appendix;

    return setDoc(document, data);
}

export function getSimpleOfferSignalingTo(key, peer, appendix){
    const myid = generateSelfID();
    const firestore = getFirestore();

    console.debug("getSimpleOfferSignalingTo(): myid is ", myid)
    return (description) => {
        const retval = getFromPeer(doc(firestore, top_collection, key, myid, peer));

        sendToPeer(doc(firestore, top_collection, key, peer, myid), description, appendix);

        return retval;
    };
}

export async function waitForOfferSignalingFrom(key, peer){
    const myid = generateSelfID();
    const firestore = getFirestore();

    console.debug("waitForOfferSignalingFrom:() myid is ", myid)
    const data = await getFromPeer(doc(firestore, top_collection, key, myid, peer));

    data['answerSignaling'] = (description, appendix) => {
        return sendToPeer(doc(firestore, top_collection, key, peer, myid), description, appendix);
    };
    return data;
}
