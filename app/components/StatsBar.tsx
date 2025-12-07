'use client';

interface Props {
    totalCount: number;
    lastUpdated: string;
    isScraping: boolean;
    soundEnabled: boolean;
    onToggleSound: () => void;
}

export default function StatsBar({ totalCount, lastUpdated, isScraping, soundEnabled, onToggleSound }: Props) {
    return (
        <div className="stats-bar">
            <div className="stat-item">
                In Stock: <span className="stat-value">{totalCount}</span>
            </div>
            <div className="stat-item">
                Updated: <span className="stat-value">{lastUpdated}</span>
                {isScraping ? (
                    <span className="loading-indicator" title="Monitoring Active - Running all the time"></span>
                ) : (
                    <span className="loading-indicator" style={{ background: '#333', animation: 'none' }} title="Waiting for next cycle..."></span>
                )}
                <button
                    className={`sound-toggle ${soundEnabled ? 'active' : ''}`}
                    onClick={onToggleSound}
                >
                    Sound: {soundEnabled ? 'ON' : 'OFF'}
                </button>
            </div>
        </div>
    );
}
