# Environment Variables

This document lists all the environment variables required for the Zendvo backend.

## AWS S3 Configuration (Image Upload)

The following environment variables are required for the image upload feature:

- `AWS_ACCESS_KEY_ID` - AWS access key ID for S3 access
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key for S3 access
- `AWS_REGION` - AWS region where the S3 bucket is located (default: us-east-1)
- `AWS_S3_BUCKET_NAME` - Name of the S3 bucket for storing uploaded images

### Example

```bash
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=zendvo-uploads
```

### S3 Bucket Setup

1. Create an S3 bucket in your AWS account
2. Configure the bucket with a public bucket policy granting `s3:GetObject` access for `uploads/*`, matching the direct S3 URLs returned by the storage implementation.
3. Set up CORS if needed for your frontend domain
4. Ensure the IAM user/role has the following permissions:
   - `s3:PutObject`
5. For IAM role/instance profile deployments, omit AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to use default credential chain

### Security Notes

- Never commit actual AWS credentials to version control
- Use IAM roles with least privilege in production
- Consider using AWS S3 bucket policies instead of ACLs for better security
- Enable server-side encryption for uploaded files
