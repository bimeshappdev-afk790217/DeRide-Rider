import { RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { ethers } from 'ethers';

const ALCHEMY_URL   = process.env.EXPO_PUBLIC_ALCHEMY_URL               ?? "";
const MESSAGE_RELAY = process.env.EXPO_PUBLIC_MESSAGE_RELAY_ADDRESS      ?? "";

const RELAY_ABI = [
  "function postMessage(address to, bytes calldata data) external",
  "function hasMessage(address wallet) external view returns (bool exists, bool expired)",
  "function getMessage(address wallet) external view returns (address from, bytes memory data, uint256 timestamp, bool expired)",
  "function clearMessage() external",
];

const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

async function waitForIce(pc: RTCPeerConnection): Promise<void> {
  return new Promise<void>(resolve => {
    if ((pc as any).iceGatheringState === 'complete') { resolve(); return; }
    const done = () => resolve();
    (pc as any).onicecandidate = (e: any) => {
      if (e.candidate === null) done();
    };
    (pc as any).onicegatheringstatechange = () => {
      if ((pc as any).iceGatheringState === 'complete') done();
    };
    setTimeout(done, 8000);
  });
}

export class WebRTCGPSAnswerer {
  private pc:           RTCPeerConnection | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  onGPSUpdate?:    (lat: number, lng: number) => void;
  onConnected?:    () => void;
  onDisconnected?: () => void;

  async start(
    privateKey:   string,
    riderWallet:  string,
    rideId:       string,
  ): Promise<void> {
    if (!ALCHEMY_URL || !MESSAGE_RELAY) {
      console.warn("[WEBRTC] ALCHEMY_URL or MESSAGE_RELAY not configured");
      return;
    }
    console.log("[WEBRTC] Answerer waiting for driver offer (rideId:", rideId.slice(0, 10), ")");

    const provider   = new ethers.JsonRpcProvider(ALCHEMY_URL);
    const signer     = new ethers.Wallet(privateKey, provider);
    const relayRead  = new ethers.Contract(MESSAGE_RELAY, RELAY_ABI, provider);
    const relayWrite = new ethers.Contract(MESSAGE_RELAY, RELAY_ABI, signer);

    this.pollInterval = setInterval(async () => {
      try {
        const [exists, expired] = await relayRead.hasMessage(riderWallet);
        if (!exists || expired) return;
        const [from, dataBytes, timestamp] = await relayRead.getMessage(riderWallet);
        const age = Math.floor(Date.now() / 1000) - Number(timestamp);
        if (age > 300) return;
        const msg = JSON.parse(ethers.toUtf8String(dataBytes));
        if (msg.type !== "WEBRTC_OFFER" || msg.rideId !== rideId) return;

        clearInterval(this.pollInterval!);
        this.pollInterval = null;
        console.log("[WEBRTC] Got offer from driver:", (from as string).slice(0, 8));

        const pc = new RTCPeerConnection(RTC_CONFIG);
        this.pc  = pc;

        (pc as any).ondatachannel = (event: any) => {
          const channel = event.channel;
          console.log("[WEBRTC] Data channel received:", channel.label);
          channel.onopen    = () => { console.log("[WEBRTC] Data channel open"); this.onConnected?.(); };
          channel.onclose   = () => { console.log("[WEBRTC] Data channel closed"); this.onDisconnected?.(); };
          channel.onmessage = (e: any) => {
            try {
              const data = JSON.parse(e.data);
              if (typeof data.lat === 'number' && typeof data.lng === 'number') {
                this.onGPSUpdate?.(data.lat, data.lng);
              }
            } catch { /* ignore malformed */ }
          };
        };

        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIce(pc);

        const sdp = (pc.localDescription as any)?.sdp;
        if (!sdp) { console.error("[WEBRTC] No answer SDP after ICE"); return; }

        // Clear offer from our inbox, then post answer to driver
        await relayWrite.clearMessage({ gasLimit: 100_000 });
        const feeData  = await provider.getFeeData();
        const maxFee   = feeData.maxFeePerGas! * 130n / 100n;
        const answerMsg = JSON.stringify({ type: "WEBRTC_ANSWER", sdp });
        const tx = await relayWrite.postMessage(from, ethers.toUtf8Bytes(answerMsg), { maxFeePerGas: maxFee });
        await tx.wait();
        console.log("[WEBRTC] Answer posted to driver:", (from as string).slice(0, 8));
      } catch (e: any) {
        console.warn("[WEBRTC] Offer poll / answer error:", e.message);
      }
    }, 4000);
  }

  stop() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    this.pc?.close();
    this.pc = null;
  }
}
