const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',') 
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Business-Id']
}));

// Middlewares
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routing
const authRoutes     = require('./routes/auth');
const businessRoutes = require('./routes/business');
const productRoutes  = require('./routes/product');
const invoiceRoutes  = require('./routes/invoice');
const categoryRoutes = require('./routes/category');
const uploadRoutes   = require('./routes/upload');
const customerRoutes = require('./routes/customer');
const expenseRoutes  = require('./routes/expense');
const staffRoutes    = require('./routes/staff');

app.use('/api/auth',       authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/products',   productRoutes);
app.use('/api/invoices',   invoiceRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/upload',     uploadRoutes);
app.use('/api/customers',  customerRoutes);
app.use('/api/expenses',   expenseRoutes);
app.use('/api/staff',      staffRoutes);

// Health Check API
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'Leka Retail Billing API' });
});

// 404 Route handler
app.use((req, res, next) => {
  res.status(404);
  const error = new Error(`Not Found - ${req.originalUrl}`);
  next(error);
});

// Global Error Handler
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);
  
  console.error(`Error: ${err.message}`);
  if (err.stack && process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  res.json({
    success: false,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
});

module.exports = app;
