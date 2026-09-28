import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://staking:staking@localhost:5432/staking', max: 5 });
