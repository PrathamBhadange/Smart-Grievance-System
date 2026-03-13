/**
 * localDb.js - A simple JSON file-based database to replace MongoDB.
 * Data is stored in JSON files in the /backend/data/ directory.
 * Provides Mongoose-like query methods so the rest of the code works with minimal changes.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

class LocalCollection {
    constructor(name) {
        this.name = name;
        this.filePath = path.join(DATA_DIR, `${name}.json`);
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                return JSON.parse(raw);
            }
        } catch (err) {
            console.error(`Error loading ${this.name}.json:`, err.message);
        }
        return [];
    }

    _save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (err) {
            console.error(`Error saving ${this.name}.json:`, err.message);
        }
    }

    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    }

    _matchesQuery(item, query) {
        for (const key in query) {
            const condition = query[key];
            const value = item[key];

            if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
                // Handle MongoDB-style operators
                if ('$in' in condition) {
                    if (!condition.$in.includes(value)) return false;
                }
                if ('$nin' in condition) {
                    if (condition.$nin.includes(value)) return false;
                }
                if ('$lt' in condition) {
                    const compareVal = value instanceof Date ? value : new Date(value);
                    const condVal = condition.$lt instanceof Date ? condition.$lt : new Date(condition.$lt);
                    if (!(compareVal < condVal)) return false;
                }
                if ('$gt' in condition) {
                    const compareVal = value instanceof Date ? value : new Date(value);
                    const condVal = condition.$gt instanceof Date ? condition.$gt : new Date(condition.$gt);
                    if (!(compareVal > condVal)) return false;
                }
                if ('$gte' in condition) {
                    const compareVal = value instanceof Date ? value : new Date(value);
                    const condVal = condition.$gte instanceof Date ? condition.$gte : new Date(condition.$gte);
                    if (!(compareVal >= condVal)) return false;
                }
                if ('$lte' in condition) {
                    const compareVal = value instanceof Date ? value : new Date(value);
                    const condVal = condition.$lte instanceof Date ? condition.$lte : new Date(condition.$lte);
                    if (!(compareVal <= condVal)) return false;
                }
            } else {
                // Direct comparison
                if (value !== condition) return false;
            }
        }
        return true;
    }

    // Find all matching documents
    find(query = {}) {
        let results = this.data.filter(item => this._matchesQuery(item, query));
        
        // Return a chainable object with sort()
        return {
            _results: results,
            sort(sortObj) {
                const key = Object.keys(sortObj)[0];
                const order = sortObj[key]; // 1 = asc, -1 = desc
                this._results.sort((a, b) => {
                    if (a[key] < b[key]) return -1 * order;
                    if (a[key] > b[key]) return 1 * order;
                    return 0;
                });
                return this;
            },
            select(fields) {
                // Simplified select - just ignore for local storage, return all fields
                return this;
            },
            then(resolve, reject) {
                try {
                    resolve(this._results);
                } catch (err) {
                    if (reject) reject(err);
                }
            }
        };
    }

    // Find one matching document
    findOne(query = {}) {
        const result = this.data.find(item => this._matchesQuery(item, query));
        
        return {
            _result: result || null,
            sort(sortObj) {
                // For findOne with sort, we need to find all matches and sort
                const allMatches = this._allData ? 
                    this._allData.filter(item => this._matchQuery(item, this._query)) : [this._result].filter(Boolean);
                
                if (allMatches.length > 1) {
                    const key = Object.keys(sortObj)[0];
                    const order = sortObj[key];
                    allMatches.sort((a, b) => {
                        if (a[key] < b[key]) return -1 * order;
                        if (a[key] > b[key]) return 1 * order;
                        return 0;
                    });
                    this._result = allMatches[0] || null;
                }
                return this;
            },
            then(resolve, reject) {
                try {
                    resolve(this._result);
                } catch (err) {
                    if (reject) reject(err);
                }
            }
        };
    }

    // Enhanced findOne that properly supports chaining with .sort()
    findOneChainable(query = {}) {
        const self = this;
        const matches = this.data.filter(item => this._matchesQuery(item, query));
        
        return {
            _results: matches,
            _result: matches[0] || null,
            sort(sortObj) {
                const key = Object.keys(sortObj)[0];
                const order = sortObj[key];
                this._results.sort((a, b) => {
                    if (a[key] < b[key]) return -1 * order;
                    if (a[key] > b[key]) return 1 * order;
                    return 0;
                });
                this._result = this._results[0] || null;
                return this;
            },
            then(resolve, reject) {
                try {
                    resolve(this._result);
                } catch (err) {
                    if (reject) reject(err);
                }
            }
        };
    }

    // Create (insert) a new document
    create(doc) {
        const now = new Date().toISOString();
        const newDoc = {
            _id: this._generateId(),
            ...doc,
            createdAt: doc.createdAt || now,
            updatedAt: doc.updatedAt || now
        };
        this.data.push(newDoc);
        this._save();
        return newDoc;
    }

    // Find one and update
    findOneAndUpdate(query, update, options = {}) {
        const index = this.data.findIndex(item => this._matchesQuery(item, query));
        if (index === -1) return Promise.resolve(null);

        let doc = { ...this.data[index] };

        // Handle $set or direct field updates
        const directUpdates = {};
        for (const key in update) {
            if (key === '$inc') {
                for (const field in update.$inc) {
                    doc[field] = (doc[field] || 0) + update.$inc[field];
                }
            } else if (key === '$push') {
                for (const field in update.$push) {
                    if (!Array.isArray(doc[field])) doc[field] = [];
                    doc[field].push(update.$push[field]);
                }
            } else if (key === '$set') {
                Object.assign(directUpdates, update.$set);
            } else if (!key.startsWith('$')) {
                directUpdates[key] = update[key];
            }
        }

        Object.assign(doc, directUpdates);
        doc.updatedAt = new Date().toISOString();

        this.data[index] = doc;
        this._save();

        return Promise.resolve(options.new ? doc : this.data[index]);
    }

    // Find one and delete
    findOneAndDelete(query) {
        const index = this.data.findIndex(item => this._matchesQuery(item, query));
        if (index === -1) return Promise.resolve(null);

        const removed = this.data.splice(index, 1)[0];
        this._save();
        return Promise.resolve(removed);
    }

    // Find by ID and update
    findByIdAndUpdate(id, update, options = {}) {
        return this.findOneAndUpdate({ _id: id }, update, options);
    }
}

// Create collections
const users = new LocalCollection('users');
const complaints = new LocalCollection('complaints');
const notifications = new LocalCollection('notifications');
const escalationHistory = new LocalCollection('escalationHistory');

module.exports = { users, complaints, notifications, escalationHistory, LocalCollection };
