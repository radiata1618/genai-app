class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input.length) return true;

        const channelData = input[0]; // Mono

        // Check if we have data
        if (!channelData) return true;

        // Downsampling logic could go here if context is not 16kHz, 
        // but usually we rely on AudioContext sampleRate being set or simple decimation.
        // For simplicity, we assume the setup prefers 16kHz or we just send what we get 
        // and backend/model handles it (Gemini is robust).
        // However, sending chunks efficiently is key.

        // Convert Float32 to Int16
        for (let i = 0; i < channelData.length; i++) {
            let s = Math.max(-1, Math.min(1, channelData[i]));
            // s = s < 0 ? s * 0x8000 : s * 0x7FFF;
            // this.port.postMessage(Math.floor(s)); 
            // Sending sample by sample is too slow. We must buffer or send chunk.

            // Actually, AudioWorklet message overhead is high. 
            // Better to send Float32 chunks and convert in main thread or send Int16 buffer.
        }

        // Simplest: Post the float32 chunk to main thread
        this.port.postMessage(channelData);

        return true;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
