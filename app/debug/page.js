export const dynamic = 'force-dynamic';

export default function DebugPage() {
    // Only verify server-side env vars
    const envVars = {
        NODE_ENV: process.env.NODE_ENV,
        IS_CLOUD_RUN: process.env.IS_CLOUD_RUN,
        BACKEND_URL: process.env.BACKEND_URL,
        K_SERVICE: process.env.K_SERVICE,
        PORT: process.env.PORT,
    };

    return (
        <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
            <h1>Environment Debugger</h1>
            <pre style={{ background: '#f0f0f0', padding: '1rem', borderRadius: '4px' }}>
                {JSON.stringify(envVars, null, 2)}
            </pre>
            <p>
                <strong>Check these values:</strong><br />
                If IS_CLOUD_RUN is undefined, the deployment config is not passing it.<br />
                If BACKEND_URL is undefined, the variable injection failed.
            </p>
        </div>
    );
}
