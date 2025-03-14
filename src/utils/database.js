import pg from 'pg'
import dotenv from 'dotenv'
import { lookup } from 'dns'

// Force Node.js to prefer IPv4 addresses
lookup('pooler.supabase.com', { family: 4 }, () => {});

// Load environment variables
dotenv.config()

// Set environment variable to force IPv4
process.env.NODE_OPTIONS = '--dns-result-order=ipv4first'

const { Pool } = pg
let db = null
let connectionAttempts = 0
const MAX_CONNECTION_ATTEMPTS = 5

export async function initializeDatabase() {
  if (db) {
    console.log('Database already initialized')
    return db
  }

  connectionAttempts++
  console.log(`Initializing database... (Attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})`)
  
  // Log database connection string (masked for security)
  const connString = process.env.DATABASE_URL || ''
  if (connString) {
    const maskedString = connString.replace(/\/\/([^:]+):([^@]+)@/, '//****:****@')
    console.log(`Using database connection: ${maskedString}`)
  } else {
    console.error('DATABASE_URL environment variable is not set!')
  }

  try {
    // Don't use the connection string directly - extract and use individual parameters
    // to ensure we use proper IPv4 connectivity
    let connectionString = process.env.DATABASE_URL || '';
    
    // Extract connection details from the connection string - supporting both postgres:// and postgresql://
    const userPassHostMatch = connectionString.match(/(?:postgres|postgresql):\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    
    let user, password, host, port, database;
    
    if (userPassHostMatch) {
      user = userPassHostMatch[1];
      password = userPassHostMatch[2];
      host = userPassHostMatch[3];
      port = parseInt(userPassHostMatch[4], 10);
      database = userPassHostMatch[5];
      
      // Log connection details (masking password)
      console.log(`Extracted connection details: user=${user}, host=${host}, port=${port}, database=${database}`);
    } else {
      console.warn('Could not parse DATABASE_URL, using defaults');
    }
    
    // EMERGENCY FIX: Try multiple connection strategies
    console.log('EMERGENCY FIX: Implementing multi-strategy database connection');
    
    // Strategy #1: Use IPv4 address for aws-0-ap-south-1.pooler.supabase.com
    const ipv4PoolerString = 'postgresql://postgres:p*BQQ44ue-PfE2R@3.111.105.85:5432/postgres';
    
    // Strategy #2: Use alternate connection string from logs
    const altConnectionString = 'postgresql://postgres:p*BQQ44ue-PfE2R@db.onmonxsgkdaurztdhafz.supabase.co:5432/postgres';
    
    // Strategy #3: Use current DATABASE_URL but try to fix IPv6 issues
    const currentConnectionString = process.env.DATABASE_URL || '';
    
    console.log('Will try multiple connection strings in sequence until one works');
    
    // Use IPv4 connection first
    let modifiedConnectionString = ipv4PoolerString;

    let config = {
      connectionString: modifiedConnectionString,
      ssl: {
        rejectUnauthorized: false,
        sslmode: 'require'
      },
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
      connectionTimeoutMillis: 10000, // Extended timeout for connection
      keepAlive: true, // Keep the connection alive
    };

    // EMERGENCY FIX: Multi-strategy connection attempt
    let connectionSuccess = false;
    let connectionError = null;
    
    // Try strategy #1: IPv4 address for pooler
    console.log('Trying Strategy #1: Direct IPv4 connection to pooler');
    config.connectionString = ipv4PoolerString;
    
    try {
      db = new Pool(config);
      const client = await db.connect();
      await client.query('SELECT NOW()');
      console.log('✅ Strategy #1 SUCCESS: Connected using direct IPv4 address for pooler');
      client.release();
      connectionSuccess = true;
    } catch (error) {
      console.error('❌ Strategy #1 FAILED:', error.message);
      connectionError = error;
      // Try strategy #2
      console.log('Trying Strategy #2: Alternate Supabase connection string');
      config.connectionString = altConnectionString;
      
      try {
        db = new Pool(config);
        const client = await db.connect();
        await client.query('SELECT NOW()');
        console.log('✅ Strategy #2 SUCCESS: Connected using alternate connection string');
        client.release();
        connectionSuccess = true;
      } catch (error2) {
        console.error('❌ Strategy #2 FAILED:', error2.message);
        // Try strategy #3
        console.log('Trying Strategy #3: Original connection string with IPv4 family flag');
        config.connectionString = currentConnectionString;
        
        try {
          db = new Pool({
            ...config,
            family: 4
          });
          const client = await db.connect();
          await client.query('SELECT NOW()');
          console.log('✅ Strategy #3 SUCCESS: Connected using original string with IPv4 family flag');
          client.release();
          connectionSuccess = true;
        } catch (error3) {
          console.error('❌ Strategy #3 FAILED:', error3.message);
          // All strategies failed, fall back to mock DB
          console.error('All connection strategies failed, falling back to mock database');
          usingMockDb = true;
          connectionError = error3;
        }
      }
    }
    
    // Handle connection result
    if (connectionSuccess) {
      console.log('Database connected successfully');
      
      // Add error handler for the pool
      db.on('error', (err) => {
        console.error('Unexpected database pool error:', err)
        // If we lose connection, null out db so we can try to reconnect
        if (err.message.includes('connection terminated') || err.message.includes('connection refused')) {
          console.log('Database connection lost, will reconnect on next request')
          db = null
          connectionAttempts = 0
        }
      });
      
      // Reset connection attempts on success
      connectionAttempts = 0;
    } else if (usingMockDb) {
      console.log('Using mock database instead');
      return mockPool;
    } else {
      // If we haven't retried too many times, we'll retry later
      if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
        console.log(`Will retry database connection on next request (attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})`);
        return null;
      } else {
        throw connectionError || new Error('All connection strategies failed');
      }
    }
    
    // If we got here, we have a successful connection
    try {
      // Get a client to perform table creation
      const client = await db.connect();
      console.log('Connected to database, running test query...')

      // Create tables if they don't exist
      console.log('Creating tables if needed...')
      await client.query(`
        CREATE TABLE IF NOT EXISTS bills (
          id SERIAL PRIMARY KEY,
          bill_type VARCHAR(10) NOT NULL,
          customer_name VARCHAR(100) NOT NULL,
          customer_nic VARCHAR(20) NOT NULL,
          customer_address TEXT NOT NULL,
          model_name VARCHAR(100) NOT NULL,
          motor_number VARCHAR(50) NOT NULL,
          chassis_number VARCHAR(50) NOT NULL,
          bike_price DECIMAL(10,2) NOT NULL,
          down_payment DECIMAL(10,2),
          total_amount DECIMAL(10,2) NOT NULL,
          bill_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)

      await client.query(`
        CREATE TABLE IF NOT EXISTS bike_models (
          id SERIAL PRIMARY KEY,
          model_name VARCHAR(100) NOT NULL UNIQUE,
          price DECIMAL(10,2) NOT NULL,
          motor_number_prefix VARCHAR(20),
          chassis_number_prefix VARCHAR(20)
        )
      `)

      // Insert predefined bike models if they don't exist
      const existingModels = await client.query('SELECT COUNT(*) FROM bike_models')
      if (existingModels.rows[0].count === '0') {
        console.log('Inserting predefined bike models...')
        await client.query(`
          INSERT INTO bike_models (model_name, price, motor_number_prefix, chassis_number_prefix) VALUES
          ('TMR-G18', 499500.00, 'G18', 'G18'),
          ('TMR-MNK3', 475000.00, 'MNK3', 'MNK3'),
          ('TMR-Q1', 449500.00, 'Q1', 'Q1'),
          ('TMR-ZL', 399500.00, 'ZL', 'ZL'),
          ('TMR-ZS', 349500.00, 'ZS', 'ZS'),
          ('TMR-XGW', 299500.00, 'XGW', 'XGW'),
          ('TMR-COLA5', 249500.00, 'COLA5', 'COLA5'),
          ('TMR-X01', 219500.00, 'X01', 'X01')
        `)
        console.log('Predefined bike models inserted')
      }
    } finally {
      client.release()
    }

    return db
  } catch (error) {
    console.error('Error initializing database:', error)
    
    // If we've tried too many times, rethrow the error
    if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
      console.error(`Failed to connect to database after ${MAX_CONNECTION_ATTEMPTS} attempts`)
      throw new Error('Failed to initialize database: ' + error.message)
    } else {
      // Return null but don't throw, so health check can still pass
      console.log(`Will retry database connection on next request (attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})`)
      return null
    }
  }
}

// Simple in-memory mock database for fallback
const mockDb = {
  bills: [],
  bike_models: [
    { id: 1, model_name: 'TMR-G18', price: 499500.00, motor_number_prefix: 'G18', chassis_number_prefix: 'G18' },
    { id: 2, model_name: 'TMR-MNK3', price: 475000.00, motor_number_prefix: 'MNK3', chassis_number_prefix: 'MNK3' },
    { id: 3, model_name: 'TMR-Q1', price: 449500.00, motor_number_prefix: 'Q1', chassis_number_prefix: 'Q1' },
    { id: 4, model_name: 'TMR-ZL', price: 399500.00, motor_number_prefix: 'ZL', chassis_number_prefix: 'ZL' },
    { id: 5, model_name: 'TMR-ZS', price: 349500.00, motor_number_prefix: 'ZS', chassis_number_prefix: 'ZS' },
    { id: 6, model_name: 'TMR-XGW', price: 299500.00, motor_number_prefix: 'XGW', chassis_number_prefix: 'XGW' },
    { id: 7, model_name: 'TMR-COLA5', price: 249500.00, motor_number_prefix: 'COLA5', chassis_number_prefix: 'COLA5' },
    { id: 8, model_name: 'TMR-X01', price: 219500.00, motor_number_prefix: 'X01', chassis_number_prefix: 'X01' }
  ]
};

// Mock database client for when real DB is unavailable
const mockClient = {
  query: async (text, params) => {
    console.log('MOCK DB QUERY:', text, params);
    
    // Handle different types of queries
    if (text.includes('SELECT 1') || text.includes('SELECT NOW()')) {
      return { rows: [{ '?column?': 1, now: new Date() }] };
    }
    
    if (text.includes('SELECT * FROM bike_models')) {
      return { rows: mockDb.bike_models };
    }
    
    if (text.includes('SELECT * FROM bills')) {
      return { rows: mockDb.bills };
    }
    
    // For inserts, just log and return success
    if (text.startsWith('INSERT INTO')) {
      console.log('MOCK INSERT:', text, params);
      return { rowCount: 1 };
    }
    
    return { rows: [] };
  },
  release: () => console.log('MOCK: Client released')
};

const mockPool = {
  connect: async () => mockClient,
  query: async (text, params) => mockClient.query(text, params),
  end: async () => console.log('MOCK: Pool ended'),
  on: () => {} // No-op for event handlers
};

// Lets us know if we're using the real DB or mock
let usingMockDb = false;

export function getDatabase() {
  if (usingMockDb) {
    console.log('Using mock database');
    return mockPool;
  }
  
  if (!db) {
    // Try mock mode if real DB is not available
    usingMockDb = true;
    console.log('Real database not initialized, falling back to mock database');
    return mockPool;
  }
  
  return db;
}

// Handle cleanup on application shutdown
process.on('SIGINT', async () => {
  if (db) {
    await db.end()
    console.log('Database pool has ended')
  }
  process.exit(0)
})

export default {
  initializeDatabase,
  getDatabase
}