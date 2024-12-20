import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';
import BcryptHelper from 'src/helpers/bcrypt.helper';
import JWTHelper from 'src/helpers/jwt.helper';
import UserFilter from './user.filter';
import { Types } from 'mongoose';

@Injectable()
export class UserService {
    constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

    async register(email: string, username: string, password: string): Promise<object> {
        const existingUser = await this.userModel.findOne({
            $or: [{ email }, { username }],
        });
        if (existingUser) {
            throw new ConflictException('Email or username already exists');
        }

        const hashedPassword = await BcryptHelper.hash(password);

        const user = new this.userModel({ email, username, password: hashedPassword });
        const returnedUser = await user.save();
        return UserFilter.makeBasicFilter(returnedUser);
    }

    async login(
        email: string,
        password: string,
    ): Promise<{
        user: Partial<User>;
        accessToken: string;
        refreshToken: string;
    }> {
        const foundUser = await this.userModel.findOne({ email });
        if (!foundUser) {
            throw new ConflictException('User not found!');
        }

        const isPasswordMatch = await BcryptHelper.compare(password, foundUser.password);
        if (isPasswordMatch === false) {
            throw new BadRequestException('Credentials are incorrect!');
        }

        const accessToken = JWTHelper.generateToken(
            {
                email: foundUser.email,
                username: foundUser.username,
                id: foundUser._id.toString(),
            },
            '15s',
        );
        const refreshToken = JWTHelper.generateToken(
            {
                id: foundUser._id.toString(),
            },
            '1h',
        );
        await this.userModel.updateOne({ email }, { refreshToken });

        return {
            user: UserFilter.makeBasicFilter(foundUser),
            accessToken,
            refreshToken,
        };
    }

    async logout(userId: string): Promise<void> {
        await this.userModel.updateOne({ _id: userId }, { refreshToken: '' });
    }

    async getProfile(userId: string): Promise<object> {
        const user = (await this.userModel.findById(new Types.ObjectId(userId)).lean()) as Partial<User>;
        if (!user) {
            throw new BadRequestException('User not found');
        }

        return UserFilter.makeDetailFilter(user);
    }

    async invokeNewTokens(refreshToken: string, userId: string): Promise<object> {
        const user = await this.userModel.findById(new Types.ObjectId(userId));
        if (!user) {
            throw new BadRequestException('User not found');
        }

        if (user.refreshToken !== refreshToken) {
            throw new BadRequestException('Access denied!');
        }

        const newAccessToken = JWTHelper.generateToken(
            {
                email: user.email,
                username: user.username,
                id: user._id.toString(),
            },
            '15s',
        );
        const newRefreshToken = JWTHelper.generateToken(
            {
                id: user._id.toString(),
            },
            '1h',
        );

        await this.userModel.updateOne({ _id: user._id }, { refreshToken: newRefreshToken });

        return {
            user: UserFilter.makeBasicFilter(user),
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        };
    }

    async findById(userId: string): Promise<User> {
        return this.userModel.findById(userId).exec();
    }
}
