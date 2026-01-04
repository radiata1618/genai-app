class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = []; // Queue of Float32Arrays
        this.currentFrame = 0;
        this.isPlaying = true;

        this.port.onmessage = (event) => {
            if (event.data.type === 'buffer') {
                this.buffer.push(new Float32Array(event.data.audio));
            } else if (event.data.type === 'clear') {
                this.buffer = [];
                this.currentFrame = 0;
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];

        // If we have no data, output silence
        if (this.buffer.length === 0) {
            return true;
        }

        const bufferSize = channel.length; // usually 128
        let outputIndex = 0;

        while (outputIndex < bufferSize && this.buffer.length > 0) {
            const currentChunk = this.buffer[0];
            const remainingInChunk = currentChunk.length - this.currentFrame;
            const neededForBuffer = bufferSize - outputIndex;

            const copyLength = Math.min(remainingInChunk, neededForBuffer);

            // Copy data to output
            for (let i = 0; i < copyLength; i++) {
                channel[outputIndex + i] = currentChunk[this.currentFrame + i];
            }

            this.currentFrame += copyLength;
            outputIndex += copyLength;

            // Check if we finished this chunk
            if (this.currentFrame >= currentChunk.length) {
                this.buffer.shift(); // Remove used chunk
                this.currentFrame = 0;
            }
        }

        // Fill remaining with silence if specific chunk ended
        // (Though usually process() is called continuously)

        return true;
    }
}

registerProcessor('pcm-player-processor', PCMPlayerProcessor);
