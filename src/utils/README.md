# Asset Image Utilities

This module provides utility functions for finding and converting asset images from Cardano blockchain metadata.

## Functions

### `findAssetImage(asset: AssetMetadata): string | null`

Finds the best available image for an asset from various metadata sources. Returns the converted image URL or `null` if no image is found.

**Priority order:**
1. Token registry metadata logo
2. CIP68 metadata image  
3. 721 metadata (NFT standard) - exact match by asset name
4. 721 metadata - fuzzy match by asset name
5. Files metadata
6. Direct image metadata

**Example:**
```typescript
import { findAssetImage } from '../utils/assetImageUtils';

const imageUrl = findAssetImage(asset);
if (imageUrl) {
    // Use the image URL
    console.log('Found image:', imageUrl);
}
```

### `convertIpfsUrl(url: string | null | undefined): string | null`

Converts IPFS URLs to HTTP URLs that browsers can fetch.

**Supported formats:**
- `ipfs://QmHash...` → `https://ipfs.io/ipfs/QmHash...`
- `QmHash...` → `https://ipfs.io/ipfs/QmHash...`
- `bafyHash...` → `https://ipfs.io/ipfs/bafyHash...`
- Regular HTTP URLs are returned unchanged

**Example:**
```typescript
import { convertIpfsUrl } from '../utils/assetImageUtils';

const httpUrl = convertIpfsUrl('ipfs://QmV88THgdqwAP5vydCoVVZP5sixZosUjFHBPagXVYZiHAX');
// Returns: https://ipfs.io/ipfs/QmV88THgdqwAP5vydCoVVZP5sixZosUjFHBPagXVYZiHAX
```

### `getAllAssetImages(asset: AssetMetadata): string[]`

Returns all available image URLs for an asset (useful for debugging or fallback scenarios).

**Example:**
```typescript
import { getAllAssetImages } from '../utils/assetImageUtils';

const allImages = getAllAssetImages(asset);
console.log('All available images:', allImages);
```

## Types

### `AssetMetadata`

Interface for asset metadata structure:

```typescript
interface AssetMetadata {
    assetInfo?: {
        token_registry_metadata?: {
            logo?: string;
        };
        cip68_metadata?: {
            image?: string;
        };
        minting_tx_metadata?: {
            '721'?: Record<string, Record<string, any>>;
            files?: Array<{ src: string }>;
            image?: string;
        };
        asset_name_ascii?: string;
    };
    assetName?: string;
    policyId?: string;
}
```

## Usage in Components

```typescript
import React from 'react';
import { findAssetImage } from '../utils/assetImageUtils';

function AssetDisplay({ asset }) {
    const imageUrl = findAssetImage(asset);
    
    return (
        <div>
            {imageUrl ? (
                <img src={imageUrl} alt="Asset" />
            ) : (
                <div>No image available</div>
            )}
        </div>
    );
}
```

## Features

- **Automatic IPFS conversion**: Converts IPFS URLs to HTTP URLs automatically
- **Multiple metadata sources**: Searches through various Cardano metadata standards
- **Smart matching**: Uses `asset_name_ascii` for reliable asset name matching
- **Fallback support**: Multiple fallback strategies for finding images
- **Type safety**: Full TypeScript support with proper interfaces
- **Reusable**: Can be used across different components and projects
