import express from 'express';
const router = express.Router();

router.get('/', (req, res) => {
    res.sendFile('latest_qr.html', { root: '.' });
});

export default router;