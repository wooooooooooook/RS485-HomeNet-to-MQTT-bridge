#!/bin/bash

echo "Cleaning build directories..."

# Remove dist directories in packages
rm -rf packages/core/dist
rm -rf packages/service/dist
rm -rf packages/simulator/dist
rm -rf packages/ui/dist
rm -rf packages/service/static
rm -f packages/ui/vite.config.ts.timestamp-*.mjs

echo "Build directories cleaned."