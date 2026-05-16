#!/bin/bash

# LLM Council - Start script

echo "Starting LLM Council..."
echo ""

# Install backend dependencies
echo "Installing backend dependencies..."
uv sync
echo ""

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd frontend
npm install
cd ..
echo ""

# Start backend
echo "Starting backend on http://127.0.0.1:8001..."
uv run python -m backend.main > backend.log 2>&1 &
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 3

if ps -p $BACKEND_PID > /dev/null
then
   echo "✓ Backend is running (PID: $BACKEND_PID)"
else
   echo "✗ Backend failed to start. Check backend.log"
   cat backend.log
   exit 1
fi

# Start frontend
echo "Starting frontend on http://127.0.0.1:5173..."
cd frontend
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!

echo ""
echo "✓ LLM Council is running!"
echo "  Backend:  http://localhost:8001"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
