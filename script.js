const socket = io("https://apitest.mydialecta.com");
let techSupportSocket;
let device, sendTransport, recvTransport;
let producers = {};
let consumers = {};
let myRole = "student";
const userRoles = {}; // { userId: "tutor" | "student" }
let isMuted = false;
let serverMuted = false;
let localAudioTrack = null;
let tutorId = null;
const consumedProducers = new Set();
let sessionId, userId;
const videoContainer = document.getElementById("videos");
const remoteVideoContainer = document.getElementById("videoContainer");
const tutorVideoContainer = document.getElementById("tutorVideoContainer");
const chatInput = document.getElementById("chatInput");
const sendChat = document.getElementById("sendChat");
const messagesContainer = document.getElementById("messages");
const techSupportInput = document.getElementById("techSupportInput");
const sendTechSupportBtn = document.getElementById("sendTechSupport");
const techSupportMessagesDiv = document.getElementById("supportChatMessages");
// const userId = "67c46c6d4643e114f1319132";
// const userId = "67c57525f5a4e710fda6fe58";
// const userId = "67ce268eddfbd0c08b5fdf8a";
// const sessionId = "67d433b2d262017844bc4211";

const joinSession = async () => {
  console.log("connected");
  userId = document.getElementById("userId").value.trim();
  sessionId = document.getElementById("sessionId").value.trim();

  if (!userId || !sessionId) {
    alert("Please enter both User ID and Session ID");
    return;
  }

  const joinSessionRep = await socket.emitWithAck("joinSession", {
    sessionId,
    userId,
  });

  // ✅ Now establish connection to tech-support namespace
  techSupportSocket = io("https://apitest.mydialecta.com/tech-support", {
    query: { userId },
  });

  techSupportSocket.emit("join-tech-room", {
    sessionId,
    userId,
    role: "user",
  });
  techSupportSocket.on(
    "new-tech-support-message",
    ({ sender, message, timestamp }) => {
      console.log(message);
      if (sender !== "attendant") return;
      const msgElem = document.createElement("div");
      msgElem.innerHTML = `
    <div style="margin-bottom: 6px;">
      <strong>${sender}:</strong> ${message}
      <div style="font-size:10px; color:gray;">${new Date(
        timestamp
      ).toLocaleTimeString()}</div>
    </div>
  `;
      techSupportMessagesDiv.appendChild(msgElem);
      techSupportMessagesDiv.scrollTop = techSupportMessagesDiv.scrollHeight;
    }
  );

  myRole = joinSessionRep.role;
  tutorId = joinSessionRep.tutorId;

  device = new mediasoupClient.Device();
  await device.load({
    routerRtpCapabilities: joinSessionRep.routerRtpCapabilities,
  });

  await createSendTransport();
  await startProducing();

  if (joinSessionRep.producers && joinSessionRep.producers.length > 0) {
    requestConsumerTransport(joinSessionRep, socket, device, sessionId, userId);
  }

  socket.on("newProducer", async ({ producerId, userId: producerUserId }) => {
    if (producerUserId === userId) return;

    console.log(`📡 New producer from ${producerUserId}: ${producerId}`);

    if (consumedProducers.has(producerId)) {
      console.log(`⏭️ Already consumed producer ${producerId}`);
      return;
    }

    if (!recvTransport) {
      const consumerTransportParams = await socket.emitWithAck(
        "request-consumer-transport",
        {
          sessionId,
          userId,
        }
      );

      recvTransport = connectConsumerTransport(
        sessionId,
        userId,
        consumerTransportParams,
        device,
        socket
      );
    }

    // 🔁 Reuse your existing consumer logic
    await consumeMedia(recvTransport, sessionId, userId, device, socket);
  });

  socket.on("user-mute-status", ({ userId: targetUserId, muted }) => {
    console.log(`🔊 ${targetUserId} is now ${muted ? "muted" : "unmuted"}`);

    if (targetUserId === userId) {
      serverMuted = muted;
      const btn = document.getElementById("toggle-mute");

      if (muted) {
        isMuted = true;
        if (localAudioTrack) localAudioTrack.enabled = false;
        btn.disabled = true;
        btn.textContent = "🚫 Muted by Server";
      } else {
        isMuted = false;
        btn.disabled = false;
        btn.textContent = "🔇 Mute";
      }
    }

    // Optional: show a mute icon under that user's video
  });

  socket.on("user-mute-status", ({ userId: targetUserId, muted }) => {
    console.log(
      `🔊 User ${targetUserId} is now ${muted ? "muted" : "unmuted"}`
    );

    if (targetUserId === userId) {
      serverMuted = muted;

      const btn = document.getElementById("toggle-mute");

      if (muted) {
        isMuted = true;
        if (localAudioTrack) localAudioTrack.enabled = false;
        btn.disabled = true;
        btn.textContent = "🚫 Muted by Server";
      } else {
        isMuted = false;
        btn.disabled = false;
        btn.textContent = "🔇 Mute";
      }
    }

    // TODO (optional): show mute icon under video for other users
  });
  socket.on(
    "user-mute-status",
    ({ userId: targetUserId, muted, admin, kind }) => {
      if (targetUserId === userId && kind === "audio") {
        serverMuted = muted;

        const btn = document.getElementById("toggle-mute");
        isMuted = muted;

        if (localAudioTrack) localAudioTrack.enabled = !muted;

        if (muted && admin) {
          btn.disabled = true;
          btn.textContent = "🚫 Muted by Admin";
        } else {
          btn.disabled = false;
          btn.textContent = muted ? "🎤 Unmute" : "🔇 Mute";
        }
      }

      // TODO: Show mute icon under remote user's video
    }
  );
  socket.on("user-disconnected", ({ userId: targetUserId }) => {
    console.log(`👋 User ${targetUserId} disconnected. Removing their video.`);

    // Remove their video element
    const remoteVideo = document.getElementById(`remote-video-${targetUserId}`);
    if (remoteVideo) {
      remoteVideo.remove();
    }

    // Optionally: stop and remove media tracks
    const consumerEntries = Object.entries(consumers);
    for (const [producerId, consumer] of consumerEntries) {
      if (consumer.appData?.userId === targetUserId) {
        try {
          consumer.close();
        } catch (e) {}
        delete consumers[producerId];
      }
    }
  });
};

async function createSendTransport() {
  return new Promise((resolve) => {
    socket.emit(
      "request-producer-transport",
      { sessionId, userId },
      async (transportParams) => {
        sendTransport = device.createSendTransport(transportParams);

        sendTransport.on("connect", ({ dtlsParameters }, callback) => {
          socket.emit(
            "connect-producer-transport",
            { sessionId, userId, dtlsParameters },
            callback
          );
        });

        sendTransport.on("produce", ({ kind, rtpParameters }, callback) => {
          socket.emit(
            "startProducing",
            { sessionId, userId, kind, rtpParameters },
            (producerId) => {
              console.log("Started producing", producerId);
              producers[producerId] = true;
              console.log(`✅ Started producing ${kind} with id ${producerId}`);
              callback({ id: producerId });
            }
          );
        });

        resolve();
      }
    );
  });
}

async function startProducing() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  addVideo(stream, userId); // Show local video

  for (const track of stream.getTracks()) {
    if (track.kind === "audio") {
      localAudioTrack = track;
      localAudioTrack.enabled = true;
      localAudioTrack.autoplay = true;
      console.log("🎤 Local audio track captured:", track);
    }
    await sendTransport.produce({ track });
  }

  document.getElementById("toggle-mute").style.display = "inline-block";
}

function addVideo(stream, userId) {
  let existingVideo = document.getElementById(`video-${userId}`);

  if (existingVideo) {
    console.log(`Updating video for ${userId}`);
    existingVideo.srcObject = stream;
    return;
  }

  console.log(`Adding video for ${userId}`);

  const video = document.createElement("video");
  video.id = `video-${userId}`;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true; // important for local video
  video.srcObject = stream;

  // 👇 Determine role for styling and placement
  const role = myRole || "student"; // myRole is set from joinSession response
  video.className = `video-box ${role}`;

  video.onloadedmetadata = () => {
    video
      .play()
      .catch((err) => console.error("🔇 Local video play error:", err));
  };
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length > 0) {
    const audioStream = new MediaStream([audioTracks[0]]);
    const localAudio = document.createElement("audio");
    localAudio.id = `local-audio-${userId}`;
    localAudio.srcObject = audioStream;
    localAudio.autoplay = true;
    localAudio.muted = false; // Must NOT be muted if you want to hear it locally

    localAudio.play().catch((err) => {
      console.error("🔇 Local audio play error:", err);
    });

    // Append audio element to body (or hidden container)
    document.body.appendChild(localAudio);
  }

  // 👑 Tutor video at the top
  if (role === "tutor") {
    tutorVideoContainer.prepend(video); // Needs tutorVideoContainer in HTML
  } else {
    remoteVideoContainer.appendChild(video);
  }
}

const requestConsumerTransport = async (
  consumeData,
  socket,
  device,
  sessionId,
  userId
) => {
  // for (const producer of consumeData.producers) {
  // This block wil not run if there is NO
  const consumerTransportParams = await socket.emitWithAck(
    "request-consumer-transport",
    { sessionId, userId }
  );

  console.log("consumerTransportParams", consumerTransportParams);

  recvTransport = connectConsumerTransport(
    sessionId,
    userId,
    consumerTransportParams,
    device,
    socket
  );

  // const consumeMediaParams = await Promise.all([

  await consumeMedia(recvTransport, sessionId, userId, device, socket);

  // ]);
  // console.log("consumerTransportParams", consumerTransportParams);
};

const connectConsumerTransport = (
  sessionId,
  userId,
  consumerTransportParams,
  device,
  socket
) => {
  if (!consumerTransportParams) {
    console.error("❌ Consumer transport parameters missing!");
    return null;
  }
  const consumerTransport = device.createRecvTransport(consumerTransportParams);
  recvTransport = consumerTransport;
  recvTransport.on("connectionstatechange", (state) => {
    console.log("==connectionstatechange==");
    console.log(state);
  });
  recvTransport.on("icegatheringstatechange", (state) => {
    console.log("==icegatheringstatechange==");
    console.log(state);
  });

  recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    console.log("Consumer trasport connect event has fired!!");
    // TO DO goes inside here
    const connectResp = await socket.emitWithAck("connect-consumer-transport", {
      sessionId,
      userId,
      dtlsParameters,
    });

    if (connectResp === "success") {
      console.log("connectResp is back!!!", connectResp);
      callback();
    } else {
      errback();
    }
  });

  return consumerTransport;
};

const consumeMedia = async (
  recvTransport,
  sessionId,
  userId,
  device,
  socket
) => {
  if (!recvTransport) {
    console.error("❌ No consumer transport available!");
    return;
  }

  const consumerParams = await socket.emitWithAck("consume-media", {
    sessionId,
    userId,
    rtpCapabilities: device.rtpCapabilities,
  });

  console.log("device.rtpCapabilities", device.rtpCapabilities);

  if (!consumerParams || consumerParams.length === 0) {
    console.log("No producers to consume.");
    return;
  }

  const producersToConsume = consumerParams.filter(
    (producer) => producer.userId !== userId
  );

  for (const params of producersToConsume) {
    if (consumers[params.producerId]) {
      console.log(`⏭️ Already consuming producer ${params.producerId}`);
      continue;
    }

    try {
      console.log(params);
      console.log(
        `📡 Attempting to consume ${params.kind} from producer ${params.producerId}`
      );

      if (consumedProducers.has(params.producerId)) {
        console.log(`⏭️ Already consumed producer ${params.producerId}`);
        continue;
      }

      console.log("params", params);
      const consumer = await recvTransport.consume({
        id: params.id,
        kind: params.kind,
        producerId: params.producerId,
        rtpParameters: params.rtpParameters,
        appData: { userId: params.userId },
      });

      consumers[params.producerId] = consumer;
      consumedProducers.add(params.producerId);

      if (!consumer) {
        throw new Error(`❌ Failed to create consumer for ${params.kind}`);
      }

      console.log(`✅ Successfully consumed ${params.kind}`, consumer);

      if (!userRoles[params.userId]) {
        userRoles[params.userId] =
          params.userId === tutorId ? "tutor" : "student";
      }

      const role = userRoles[params.userId];

      if (params.kind === "audio") {
        const audioStream = new MediaStream([consumer.track]);
        const audioElement = document.createElement("audio");
        audioElement.id = `remote-audio-${params.userId}`;
        audioElement.autoplay = true;
        audioElement.srcObject = audioStream;
        audioElement
          .play()
          .catch((err) => console.error("🔇 Audio play error:", err));
        document.body.appendChild(audioElement);
      } else if (params.kind === "video") {
        const stream = new MediaStream();
        stream.addTrack(consumer.track);

        let video = document.getElementById(`remote-video-${params.userId}`);

        if (!video) {
          video = document.createElement("video");
          video.id = `remote-video-${params.userId}`;
          video.autoplay = true;
          video.playsInline = true;
          video.muted = true;
          video.srcObject = stream;

          video.className = `video-box ${role}`; // For styling

          video.onloadedmetadata = () => {
            video
              .play()
              .catch((err) => console.error("🔇 Video play error:", err));
          };

          if (role === "tutor") {
            tutorVideoContainer.prepend(video); // 👑 Put tutor on top
          } else {
            remoteVideoContainer.appendChild(video);
          }
        } else {
          console.log(`♻️ Video for user ${params.userId} already exists`);
        }
      }
    } catch (error) {
      console.error("❌ Error consuming media:", error);
    }
  }

  console.log("consume() has fired!!!!");
};

const joinRoom = document.getElementById("join-session");
joinRoom.addEventListener("click", joinSession);

document.getElementById("toggle-mute").addEventListener("click", () => {
  if (!localAudioTrack || serverMuted) return;

  isMuted = !isMuted;
  localAudioTrack.enabled = !isMuted;

  const btn = document.getElementById("toggle-mute");
  btn.textContent = isMuted ? "🎤 Unmute" : "🔇 Mute";

  console.log(isMuted ? "🔇 Audio muted" : "🎤 Audio unmuted");

  socket.emit("user-mute-toggle", { userId, sessionId, muted: isMuted });
});

// Send message
sendChat.addEventListener("click", () => {
  const message = chatInput.value.trim();
  if (!message) return;

  socket.emit("chat-message", {
    sessionId,
    userId,
    message,
  });

  appendMessage("Me", message, true); // true indicates sent message
  chatInput.value = "";
});

// Listen for incoming messages
socket.on("new-chat-message", ({ userId: senderId, message, timestamp }) => {
  if (senderId === userId) return; // Prevent echoing own message
  const sender = senderId === tutorId ? "Tutor" : "Student";
  appendMessage(sender, message, false, timestamp);
});

// Append messages to UI
function appendMessage(sender, message, isSentByMe, timestamp = new Date()) {
  const msgElem = document.createElement("div");

  msgElem.innerHTML = `
    <div style="
      max-width: 60%; 
      padding: 8px 12px; 
      border-radius: 12px; 
      margin: 5px 0; 
      background: ${isSentByMe ? "#4caf50" : "#e0e0e0"};
      color: ${isSentByMe ? "white" : "black"};
      align-self: ${isSentByMe ? "flex-end" : "flex-start"};
      word-break: break-word;">
      <div>${message}</div>
      <small style="font-size:10px; opacity:0.7;">${sender} • ${new Date(
    timestamp
  ).toLocaleTimeString()}</small>
    </div>
  `;

  msgElem.style.display = "flex";
  msgElem.style.flexDirection = "column";
  msgElem.style.alignItems = isSentByMe ? "flex-end" : "flex-start";

  messagesContainer.appendChild(msgElem);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function adminMuteUser() {
  const targetUserId = document.getElementById("targetUserId").value.trim();
  if (!targetUserId) return alert("Enter a target user ID");

  socket.emit("admin-mute-user", {
    sessionId,
    targetUserId,
    kind: "audio",
  });
}

function adminUnmuteUser() {
  const targetUserId = document.getElementById("targetUserId").value.trim();
  if (!targetUserId) return alert("Enter a target user ID");

  socket.emit("admin-unmute-user", {
    sessionId,
    targetUserId,
    kind: "audio",
  });
}
sendTechSupportBtn.addEventListener("click", () => {
  const message = techSupportInput.value.trim();
  if (!message) return;

  techSupportSocket.emit(
    "tech-support-message",
    {
      sessionId,
      userId,
      message,
    },
    (response) => {
      if (response.status === "sent") {
        alert("✅ Technical support has been notified.");
        techSupportInput.value = "";
      } else {
        alert("❌ Failed to send support request. Please retry.");
      }
    }
  );
});
