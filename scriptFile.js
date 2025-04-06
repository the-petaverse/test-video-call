// const socket = io("http://localhost:4200");
// let device, sendTransport, recvTransport;
// let producers = {}; // Store producer IDs per user
// let consumers = {}; // Track consumed streams
// let sessionId, userId;
// const videoContainer = document.getElementById("videos");

// async function joinSession() {
//   userId = document.getElementById("userId").value.trim();
//   sessionId = document.getElementById("sessionId").value.trim();

//   if (!userId || !sessionId) {
//     alert("Please enter both User ID and Session ID");
//     return;
//   }

//   socket.emit("joinSession", { userId, sessionId }, async (response) => {
//     if (!response) return alert("Error joining session");
//     console.log("Joined session:", response);

//     // Initialize Mediasoup Device
//     device = new mediasoupClient.Device();
//     await device.load({
//       routerRtpCapabilities: response.routerRtpCapabilities,
//     });

//     await createSendTransport();
//     await startProducing();

//     // Consume all existing producers
//     if (response.producers && response.producers.length > 0) {
//       for (const producerId of response.producers) {
//         await consume(producerId);
//       }
//     }

//     // Listen for new users joining
//     socket.on("newProducer", async ({ producerId }) => {
//       if (!producers[producerId]) {
//         await consume(producerId);
//       }
//     });

//     // Listen for backend requests to consume media
//     socket.on("requestConsumeMedia", async ({ producerId }) => {
//       console.log("Received request to consume media:", producerId);
//       if (!consumers[producerId]) {
//         await consume(producerId);
//       }
//     });

//     // Handle when a user leaves
//     socket.on("userLeft", ({ userId }) => {
//       removeVideo(userId);
//     });
//   });
// }

// async function createSendTransport() {
//   return new Promise((resolve) => {
//     socket.emit(
//       "request-producer-transport",
//       { sessionId, userId },
//       async (transportParams) => {
//         sendTransport = device.createSendTransport(transportParams);

//         sendTransport.on("connect", ({ dtlsParameters }, callback) => {
//           socket.emit(
//             "connect-producer-transport",
//             { sessionId, userId, dtlsParameters },
//             callback
//           );
//         });

//         sendTransport.on("produce", ({ kind, rtpParameters }, callback) => {
//           socket.emit(
//             "startProducing",
//             { sessionId, userId, kind, rtpParameters },
//             (producerId) => {
//               console.log("Started producing", producerId);
//               producers[producerId] = true;
//               callback({ id: producerId });
//             }
//           );
//         });

//         resolve();
//       }
//     );
//   });
// }

// async function startProducing() {
//   const stream = await navigator.mediaDevices.getUserMedia({
//     video: true,
//     audio: true,
//   });

//   addVideo(stream, userId); // Show local video

//   for (const track of stream.getTracks()) {
//     await sendTransport.produce({ track });
//   }
// }

// async function consume(producerId) {
//   if (!recvTransport) {
//     await createRecvTransport();
//   }

//   // Prevent duplicate consumers
//   if (consumers[producerId]) return;

//   return new Promise((resolve) => {
//     socket.emit(
//       "consume-media",
//       {
//         sessionId,
//         userId,
//         rtpCapabilities: device.rtpCapabilities,
//       },
//       async (consumersData) => {
//         if (!consumersData || consumersData.length === 0) {
//           console.warn("No consumers received");
//           return resolve();
//         }

//         for (const consumerData of consumersData) {
//           if (consumers[consumerData.consumerId]) continue; // Prevent duplicate consuming

//           const consumer = await recvTransport.consume({
//             id: consumerData.consumerId,
//             producerId: consumerData.producerId,
//             kind: consumerData.kind,
//             rtpParameters: consumerData.rtpParameters,
//           });

//           consumers[consumerData.consumerId] = consumer;

//           const stream = new MediaStream();
//           stream.addTrack(consumer.track);

//           addVideo(stream, consumerData.userId);

//           consumer.on("trackended", () => {
//             console.log(`Consumer ${consumer.id} track ended`);
//             removeVideo(consumerData.userId);
//           });
//         }

//         resolve();
//       }
//     );
//   });
// }

// async function createRecvTransport() {
//   return new Promise((resolve) => {
//     socket.emit(
//       "request-consumer-transport",
//       { sessionId, userId },
//       async (transportParams) => {
//         recvTransport = device.createRecvTransport(transportParams);

//         recvTransport.on("connect", ({ dtlsParameters }, callback) => {
//           socket.emit(
//             "connect-consumer-transport",
//             { sessionId, userId, dtlsParameters },
//             callback
//           );
//         });

//         resolve();
//       }
//     );
//   });
// }

// function addVideo(stream, userId) {
//   let existingVideo = document.getElementById(`video-${userId}`);

//   if (existingVideo) {
//     console.log(`Updating video for ${userId}`);
//     existingVideo.srcObject = stream;
//     return;
//   }

//   console.log(`Adding video for ${userId}`);

//   const video = document.createElement("video");
//   video.id = `video-${userId}`;
//   video.autoplay = true;
//   video.playsInline = true;
//   video.srcObject = stream;

//   videoContainer.appendChild(video);
// }

// function removeVideo(userId) {
//   let video = document.getElementById(`video-${userId}`);
//   if (video) {
//     console.log(`Removing video for ${userId}`);
//     videoContainer.removeChild(video);
//   }
// }
// const consumeMedia = async (
//   recvTransport,
//   sessionId,
//   userId,
//   device,
//   socket
// ) => {
//   if (!recvTransport) {
//     console.error("❌ No consumer transport available!");
//     return;
//   }

//   const consumerParams = await socket.emitWithAck("consume-media", {
//     sessionId,
//     userId,
//     rtpCapabilities: device.rtpCapabilities,
//   });
//   console.log("device.rtpCapabilities", device.rtpCapabilities);

//   if (!consumerParams || consumerParams.length === 0) {
//     console.log("No producers to consume.");
//     return;
//   }

//   const producersToConsume = consumerParams.filter(
//     (producer) => producer.userId !== userId
//   );

//   for (const params of producersToConsume) {
//     // 🔒 Skip if already consumed this producer
//     if (consumers[params.producerId]) {
//       console.log(`⏭️ Already consuming producer ${params.producerId}`);
//       continue;
//     }

//     try {
//       console.log(params);
//       console.log(
//         `📡 Attempting to consume ${params.kind} from producer ${params.producerId}`
//       );

//       const consumer = await recvTransport.consume({
//         id: params.id,
//         kind: params.kind,
//         producerId: params.producerId,
//         rtpParameters: params.rtpParameters,
//       });

//       consumers[params.producerId] = consumer;

//       if (!consumer) {
//         throw new Error(`❌ Failed to create consumer for ${params.kind}`);
//       }

//       console.log(`✅ Successfully consumed ${params.kind}`, consumer);
//       // Add video for the consumed media
//       if (!userRoles[params.userId]) {
//         userRoles[params.userId] =
//           params.userId === tutorId ? "tutor" : "student";
//       }

//       const role = userRoles[params.userId];

//       if (params.kind === "video") {
//         const stream = new MediaStream();
//         stream.addTrack(consumer.track);

//         let video = document.getElementById(`remote-video-${params.userId}`);

//         if (!video) {
//           video = document.createElement("video");
//           video.id = `remote-video-${params.userId}`;
//           video.autoplay = true;
//           video.playsInline = true;
//           video.muted = true;
//           video.srcObject = stream;

//           video.onloadedmetadata = () => {
//             video
//               .play()
//               .catch((err) => console.error("🔇 Video play error:", err));
//           };

//           remoteVideoContainer.appendChild(video);
//         } else {
//           console.log(`♻️ Video for user ${params.userId} already exists`);
//         }
//       }
//     } catch (error) {
//       console.error("❌ Error consuming media:", error);
//     }
//   }

//   console.log("consume() has fired!!!!");
// };
// function addVideo(stream, userId) {
//   let existingVideo = document.getElementById(`video-${userId}`);

//   if (existingVideo) {
//     console.log(`Updating video for ${userId}`);
//     existingVideo.srcObject = stream;
//     return;
//   }

//   console.log(`Adding video for ${userId}`);

//   const video = document.createElement("video");
//   video.id = `video-${userId}`;
//   video.autoplay = true;
//   video.playsInline = true;
//   video.srcObject = stream;

//   remoteVideoContainer.appendChild(video);
// }

// Error:
// Error in startProducing: Error: MID already exists in RTP listener [mid:1] [method:transport.produce]
//     at Channel.processResponse (/Users/micheaol/Projects/Petaverse-projects/dialecta-backend-service/node_modules/mediasoup/node/lib/Channel.js:251:33)
//     at Socket.<anonymous> (/Users/micheaol/Projects/Petaverse-projects/dialecta-backend-service/node_modules/mediasoup/node/lib/Channel.js:76:34)
