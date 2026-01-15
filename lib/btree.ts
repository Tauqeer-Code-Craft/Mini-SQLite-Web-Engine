import { PAGE_SIZE, NODE_INTERNAL, NODE_LEAF, IVirtualDisk } from '../types';

const HEADER_SIZE = 7;
const OFF_TYPE = 0;
const OFF_NUM_CELLS = 1;
const OFF_PARENT = 3;

export class BTree {
  disk: IVirtualDisk;
  rootPageId: number;

  constructor(disk: IVirtualDisk, rootPageId: number) {
    this.disk = disk;
    this.rootPageId = rootPageId;
    
    const rootPage = this.disk.readPage(rootPageId);
    if (rootPage[0] === 0 && rootPage[1] === 0 && rootPage[2] === 0 && rootPage[3] === 0) {
      const view = new DataView(rootPage.buffer);
      view.setUint8(OFF_TYPE, NODE_LEAF);
      view.setUint16(OFF_NUM_CELLS, 0);
      view.setUint32(OFF_PARENT, 0); 
      this.disk.writePage(rootPageId, rootPage);
    }
  }

  public getMaxKey(): number {
      return this.findMaxInPage(this.rootPageId);
  }

  private findMaxInPage(pageId: number): number {
      const page = this.disk.readPage(pageId);
      const view = new DataView(page.buffer);
      const type = view.getUint8(OFF_TYPE);
      const numCells = view.getUint16(OFF_NUM_CELLS);
      
      if (numCells === 0) return 0;

      let offset = HEADER_SIZE;
      
      if (type === NODE_LEAF) {
          // Leaf: [Key][Size][Data]... Scan to end to get max key (assumes sorted)
          let maxK = 0;
          for(let i=0; i<numCells; i++) {
              maxK = view.getUint32(offset);
              offset += 4;
              const s = view.getUint32(offset);
              offset += 4 + s;
          }
          return maxK;
      } else {
          // Internal: [Ptr][Key][Ptr]...
          // Go to right-most child
          // Skip to last pointer
          let rightChildId = 0;
          // P0
          rightChildId = view.getUint32(offset);
          offset += 4;
          
          for(let i=0; i<numCells; i++) {
              // Key
              offset += 4;
              // Right Ptr
              rightChildId = view.getUint32(offset);
              offset += 4;
          }
          return this.findMaxInPage(rightChildId);
      }
  }

  public insert(key: number, value: Uint8Array): void {
    const leafPageId = this.findLeafPage(this.rootPageId, key);
    this.insertIntoLeaf(leafPageId, key, value);
  }

  public search(key: number): Uint8Array | null {
    const leafPageId = this.findLeafPage(this.rootPageId, key);
    return this.findInLeaf(leafPageId, key);
  }

  public getAll(): { key: number; data: Uint8Array }[] {
    return this.traverse(this.rootPageId);
  }

  private traverse(pageId: number): { key: number; data: Uint8Array }[] {
    const page = this.disk.readPage(pageId);
    if (!page || page.length === 0) return [];
    
    const view = new DataView(page.buffer);
    const type = view.getUint8(OFF_TYPE);
    const numCells = view.getUint16(OFF_NUM_CELLS);
    const results: { key: number; data: Uint8Array }[] = [];

    if (type === NODE_LEAF) {
      let offset = HEADER_SIZE;
      for (let i = 0; i < numCells; i++) {
        const k = view.getUint32(offset);
        offset += 4;
        const size = view.getUint32(offset);
        offset += 4;
        const data = page.slice(offset, offset + size);
        offset += size;
        results.push({ key: k, data });
      }
    } else {
       let offset = HEADER_SIZE;
       const p0 = view.getUint32(offset);
       results.push(...this.traverse(p0));
       offset += 4;

       for(let i=0; i<numCells; i++) {
         offset += 4; // Skip key
         const p = view.getUint32(offset);
         offset += 4;
         results.push(...this.traverse(p));
       }
    }
    return results;
  }

  private findLeafPage(pageId: number, key: number): number {
    const page = this.disk.readPage(pageId);
    const view = new DataView(page.buffer);
    const type = view.getUint8(OFF_TYPE);

    if (type === NODE_LEAF) {
      return pageId;
    }

    const numCells = view.getUint16(OFF_NUM_CELLS);
    let offset = HEADER_SIZE;
    
    let childPageId = view.getUint32(offset);
    offset += 4;

    for (let i = 0; i < numCells; i++) {
      const cellKey = view.getUint32(offset);
      offset += 4;
      const rightChildId = view.getUint32(offset);
      offset += 4;

      if (key < cellKey) {
        return this.findLeafPage(childPageId, key);
      }
      childPageId = rightChildId;
    }

    return this.findLeafPage(childPageId, key);
  }

  private findInLeaf(pageId: number, key: number): Uint8Array | null {
    const page = this.disk.readPage(pageId);
    const view = new DataView(page.buffer);
    const numCells = view.getUint16(OFF_NUM_CELLS);
    let offset = HEADER_SIZE;

    for (let i = 0; i < numCells; i++) {
      const cellKey = view.getUint32(offset);
      offset += 4;
      const dataSize = view.getUint32(offset);
      offset += 4;
      
      if (cellKey === key) {
        return page.slice(offset, offset + dataSize);
      }
      offset += dataSize;
    }
    return null;
  }

  private insertIntoLeaf(pageId: number, key: number, value: Uint8Array) {
    const page = this.disk.readPage(pageId);
    const view = new DataView(page.buffer);
    const numCells = view.getUint16(OFF_NUM_CELLS);
    
    const spaceNeeded = 8 + value.length;
    
    let currentSize = HEADER_SIZE;
    let offset = HEADER_SIZE;
    let insertIndex = numCells;
    let found = false;

    for(let i=0; i<numCells; i++) {
        const cKey = view.getUint32(offset);
        if (cKey === key) {
             throw new Error(`Duplicate primary key: ${key}`);
        }
        if (!found && cKey > key) {
            insertIndex = i;
            found = true;
        }
        offset += 4;
        const size = view.getUint32(offset);
        offset += 4 + size;
    }
    currentSize = offset;

    if (currentSize + spaceNeeded > PAGE_SIZE) {
        this.splitLeaf(pageId, key, value);
        return;
    }

    const newPage = new Uint8Array(PAGE_SIZE);
    const newView = new DataView(newPage.buffer);
    
    newPage.set(page.subarray(0, HEADER_SIZE));
    newView.setUint16(OFF_NUM_CELLS, numCells + 1);

    let srcOffset = HEADER_SIZE;
    let dstOffset = HEADER_SIZE;

    for(let i=0; i<insertIndex; i++) {
        const k = view.getUint32(srcOffset);
        srcOffset += 4;
        const s = view.getUint32(srcOffset);
        srcOffset += 4;
        
        newView.setUint32(dstOffset, k);
        dstOffset += 4;
        newView.setUint32(dstOffset, s);
        dstOffset += 4;
        
        newPage.set(page.subarray(srcOffset, srcOffset + s), dstOffset);
        srcOffset += s;
        dstOffset += s;
    }

    newView.setUint32(dstOffset, key);
    dstOffset += 4;
    newView.setUint32(dstOffset, value.length);
    dstOffset += 4;
    newPage.set(value, dstOffset);
    dstOffset += value.length;

    for(let i=insertIndex; i<numCells; i++) {
         const k = view.getUint32(srcOffset);
        srcOffset += 4;
        const s = view.getUint32(srcOffset);
        srcOffset += 4;
        
        newView.setUint32(dstOffset, k);
        dstOffset += 4;
        newView.setUint32(dstOffset, s);
        dstOffset += 4;
        
        newPage.set(page.subarray(srcOffset, srcOffset + s), dstOffset);
        srcOffset += s;
        dstOffset += s;
    }

    this.disk.writePage(pageId, newPage);
  }

  private splitLeaf(pageId: number, key: number, value: Uint8Array) {
      const page = this.disk.readPage(pageId);
      const view = new DataView(page.buffer);
      const numCells = view.getUint16(OFF_NUM_CELLS);
      const cells: {k: number, v: Uint8Array}[] = [];

      let offset = HEADER_SIZE;
      for(let i=0; i<numCells; i++) {
          const k = view.getUint32(offset);
          offset += 4;
          const s = view.getUint32(offset);
          offset += 4;
          const v = page.slice(offset, offset + s);
          offset += s;
          cells.push({k, v});
      }

      cells.push({k: key, v: value});
      cells.sort((a,b) => a.k - b.k);

      const newPageId = this.disk.allocatePage();
      const midIndex = Math.floor(cells.length / 2);
      const splitKey = cells[midIndex].k;

      const leftCells = cells.slice(0, midIndex);
      this.writeCellsToLeaf(pageId, leftCells);

      const rightCells = cells.slice(midIndex);
      this.writeCellsToLeaf(newPageId, rightCells); 
      
      const parentPtr = view.getUint32(OFF_PARENT);
      if (pageId === this.rootPageId) {
          this.createGenericRoot(splitKey, pageId, newPageId);
      } else {
          this.insertIntoInternal(parentPtr, splitKey, newPageId);
      }
  }

  private writeCellsToLeaf(pageId: number, cells: {k: number, v: Uint8Array}[]) {
      const page = new Uint8Array(PAGE_SIZE);
      const view = new DataView(page.buffer);
      view.setUint8(OFF_TYPE, NODE_LEAF);
      view.setUint16(OFF_NUM_CELLS, cells.length);
      
      let offset = HEADER_SIZE;
      for (const cell of cells) {
          view.setUint32(offset, cell.k);
          offset += 4;
          view.setUint32(offset, cell.v.length);
          offset += 4;
          page.set(cell.v, offset);
          offset += cell.v.length;
      }
      this.disk.writePage(pageId, page);
  }

  private createGenericRoot(key: number, leftChildId: number, rightChildId: number) {
      const newRootId = this.disk.allocatePage();
      const newRoot = new Uint8Array(PAGE_SIZE);
      const view = new DataView(newRoot.buffer);
      
      view.setUint8(OFF_TYPE, NODE_INTERNAL);
      view.setUint16(OFF_NUM_CELLS, 1);
      view.setUint32(OFF_PARENT, 0);

      let offset = HEADER_SIZE;
      view.setUint32(offset, leftChildId); 
      offset += 4;
      view.setUint32(offset, key);         
      offset += 4;
      view.setUint32(offset, rightChildId);

      this.disk.writePage(newRootId, newRoot);
      this.rootPageId = newRootId;
      this.disk.setMetadata('root', newRootId);
  }

  private insertIntoInternal(pageId: number, key: number, rightChildId: number) {
      const page = this.disk.readPage(pageId);
      const view = new DataView(page.buffer);
      const numCells = view.getUint16(OFF_NUM_CELLS);
      
      if (numCells >= 100) { 
          throw new Error("Index page full - implementation limited for demo");
      }
      
      // Since implementing internal split is too large for this constraint, 
      // we only support root split in this demo properly.
      // But we can add to internal node if space permits (naive append, unsorted for simplicity or strict sort?)
      // Internal Node is sorted. We must insert key in order.
      // Structure: P0 K1 P1 K2 P2 ...
      // We have new Key and new RightChild.
      
      // Let's rebuild the internal node
      // Read all: P0, (K, P)...
      let offset = HEADER_SIZE;
      let p0 = view.getUint32(offset);
      offset += 4;
      const items: {k: number, p: number}[] = [];
      for(let i=0; i<numCells; i++) {
          const k = view.getUint32(offset);
          offset += 4;
          const p = view.getUint32(offset);
          offset += 4;
          items.push({k, p});
      }
      
      // Add new
      items.push({k: key, p: rightChildId});
      items.sort((a,b) => a.k - b.k);
      
      // Write back
      const newPage = new Uint8Array(PAGE_SIZE);
      const newView = new DataView(newPage.buffer);
      newView.setUint8(OFF_TYPE, NODE_INTERNAL);
      newView.setUint16(OFF_NUM_CELLS, items.length);
      newView.setUint32(OFF_PARENT, view.getUint32(OFF_PARENT)); // Keep parent
      
      offset = HEADER_SIZE;
      newView.setUint32(offset, p0);
      offset += 4;
      
      for(const item of items) {
          newView.setUint32(offset, item.k);
          offset += 4;
          newView.setUint32(offset, item.p);
          offset += 4;
      }
      this.disk.writePage(pageId, newPage);
  }

  public delete(key: number) {
      const leafId = this.findLeafPage(this.rootPageId, key);
      const page = this.disk.readPage(leafId);
      const view = new DataView(page.buffer);
      const numCells = view.getUint16(OFF_NUM_CELLS);
      
      const newPage = new Uint8Array(PAGE_SIZE);
      const newView = new DataView(newPage.buffer);
      newView.setUint8(OFF_TYPE, NODE_LEAF);
      
      let found = false;
      let newCount = 0;
      let srcOffset = HEADER_SIZE;
      let dstOffset = HEADER_SIZE;

      for(let i=0; i<numCells; i++) {
          const k = view.getUint32(srcOffset);
          srcOffset += 4;
          const s = view.getUint32(srcOffset);
          srcOffset += 4;
          
          if (k === key) {
              found = true;
              srcOffset += s; 
              continue; 
          }
          
          newView.setUint32(dstOffset, k);
          dstOffset += 4;
          newView.setUint32(dstOffset, s);
          dstOffset += 4;
          newPage.set(page.subarray(srcOffset, srcOffset + s), dstOffset);
          srcOffset += s;
          dstOffset += s;
          newCount++;
      }
      
      if (found) {
          newView.setUint16(OFF_NUM_CELLS, newCount);
          newView.setUint32(OFF_PARENT, view.getUint32(OFF_PARENT));
          this.disk.writePage(leafId, newPage);
      } else {
          throw new Error(`Key ${key} not found`);
      }
  }
}